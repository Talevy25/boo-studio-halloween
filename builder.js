const $=selector=>document.querySelector(selector);
let backend='',accessKey='',active=null,version=0,timer=null,operation=false,waiting=[],messages=new Map(),skip=0,onApp=()=>{},go=()=>{};
const text=(tag,content,className)=>{const el=document.createElement(tag);el.textContent=content;if(className)el.className=className;return el};
const status=message=>{$('#build-status').textContent=message};
function origin(value) {
  const u=new URL(value);if(u.username||u.password||u.search||u.hash)throw Error('Use a backend origin without credentials or query parameters.');
  if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('The backend must use HTTPS.');
  return u.origin;
}
async function api(path,{method='GET',body,requestId}={}) {
  if(!accessKey)throw Error('Connect your studio backend first.');
  let response;try{response=await fetch(`${backend}/api${path}`,{method,cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(150000),headers:{Authorization:`Bearer ${accessKey}`,...(body?{'Content-Type':'application/json'}:{}),...(requestId?{'X-Request-ID':requestId}:{})},...(body?{body:JSON.stringify(body)}:{})})}catch{throw Error('The backend did not confirm the result. Check the creation before starting another build.');}
  let data;try{data=await response.json()}catch{throw Error('This URL is not a Boo Studio backend.');}
  if(!response.ok)throw Error(data.error||'The builder could not complete this request.');return data;
}
function controls(state='unknown') {
  const locked=operation||waiting.length>0||state==='processing'||!active;
  $('#followup').disabled=locked;$('#send-followup').disabled=locked;
  $('#publish-app').disabled=locked||state!=='ready';$('#refresh-preview').disabled=operation||!active||state==='processing';
  document.querySelectorAll('#build-questions button').forEach(button=>button.disabled=operation);
}
function drawMessages() {
  const container=$('#build-messages');container.replaceChildren();
  for(const m of messages.values()){if(!m.content||m.hidden)continue;const card=text('div','',`chat-message ${m.role==='user'?'user':'assistant'}`);card.append(text('b',m.role==='user'?'You':'Boo Studio'),text('p',m.content));container.append(card)}
}
let questionSignature='';
function drawQuestions() {
  const host=$('#build-questions'),signature=JSON.stringify(waiting);
  if(signature===questionSignature)return;
  questionSignature=signature;host.replaceChildren();
  for(const q of waiting){
    const card=text('div','','agent-question'),kind=q.waiting_on?.kind;
    let args=q.arguments;try{args??=JSON.parse(q.arguments_string||'{}')}catch{args={}}
    card.append(text('h3',kind==='approval'?'Permission needed':'A little input needed'));
    let collect=()=>undefined;
    if(kind==='choice'&&Array.isArray(args.questions)&&args.questions.length){
      const groups=args.questions.map((question,i)=>{
        const group=document.createElement('fieldset');group.append(text('legend',question.question||'Choose an option'));
        const inputs=(question.options||[]).map((option,j)=>{
          const label=typeof option==='string'?option:option.label||'';
          const row=text('label','','question-option'),input=document.createElement('input');
          input.type=question.multi_select?'checkbox':'radio';input.name=`${q.id}-${i}`;input.value=label;
          row.append(input,text('span',label));group.append(row);return input;
        });card.append(group);return inputs;
      });
      collect=()=>({answers:groups.map((inputs,i)=>{const selected=inputs.filter(x=>x.checked).map(x=>x.value);if(!selected.length)throw Error('Choose an answer for each question.');return {question_index:i,selected_labels:selected}})});
    }else if(kind==='input'&&Array.isArray(args.secrets_schema)&&args.secrets_schema.length){
      card.append(text('p','These values are sent securely to the builder and are not saved in your browser.'));
      const fields=args.secrets_schema.map(field=>{
        const label=text('label',field.secretName||'Secret'),input=document.createElement('input');input.type='password';input.autocomplete='off';input.maxLength=8000;input.setAttribute('aria-label',field.secretName||'Secret');label.append(input);card.append(label);return {name:field.secretName,input};
      });collect=()=>{const secrets={};for(const f of fields){if(!f.input.value.trim())throw Error('Fill in each requested value.');secrets[f.name]=f.input.value}return {secrets}};
    }else if(kind==='approval'){
      card.append(text('p',q.approval?.reason||q.approval?.details?.summary||`Allow ${q.name||'this action'}?`));
      const details=document.createElement('details');details.append(text('summary','Action details'),text('pre',JSON.stringify(args,null,2)));card.append(details);
    }else if(kind==='choice'||kind==='input'){
      card.append(text('p',args.question||args.description||q.name||'Your answer'));
      const input=document.createElement('textarea');input.maxLength=8000;input.setAttribute('aria-label','Your answer');card.append(input);
      collect=()=>{if(!input.value.trim())throw Error('Add your answer first.');return input.value.trim()};
    }else {card.append(text('p','This question format is not supported yet.'));host.append(card);continue;}
    const actions=text('div','','dialog-actions');
    for(const decision of ['approved','rejected']){
      const button=text('button',decision==='approved'?(kind==='approval'?'Allow':'Send answer'):'Decline',decision==='approved'?'conjure':'secondary');
      button.onclick=async()=>{try{const value=decision==='approved'?collect():undefined;await answer(q,decision,value)}catch(e){status(e.message)}};actions.append(button);
    }card.append(actions);host.append(card);
  }
}
async function refresh(generation=version) {
  if(!active||generation!==version||!accessKey)return;
  const id=active.id;
  try {
    const [app,conversation]=await Promise.all([api(`/apps/${id}`),api(`/apps/${id}/messages`)]);
    if(generation!==version)return;
    active={...active,...app};onApp(active);$('#build-name').textContent=app.name;
    for(const m of conversation.messages)messages.set(m.id,m);
    // Newest window is authoritative for currently waiting tools, not historical pages.
    waiting=conversation.messages.flatMap(m=>m.tool_calls||[]);drawMessages();drawQuestions();controls(app.status.state);
    $('#older-messages').hidden=!conversation.hasMore;
    const labels={processing:'Conjuring your app…',ready:'Your build is ready.',error:'The build ran into a problem. Read the conversation below.',unknown:'Checking the build…'};
    status(waiting.length?'The builder is waiting for your answer.':app.status.state==='error'&&app.status.details?app.status.details:labels[app.status.state]||'Checking the build…');
    if(app.status.state==='ready'&&!waiting.length&&$('#live-frame').hidden&&!operation)await loadPreview(generation);
  }catch(e){if(generation===version){status(e.message);controls();}}
  if(generation===version&&(operation||waiting.length||!['ready','error'].includes(active?.status?.state)))timer=setTimeout(()=>refresh(generation),7000);
}
async function loadPreview(generation=version) {
  if(!active)return;const id=active.id;$('#preview-message').hidden=false;$('#preview-message').textContent='Waking up your preview…';
  try{const data=await api(`/apps/${id}/preview`);if(generation!==version)return;const url=new URL(data.url);if(url.protocol!=='https:'||url.origin===location.origin)throw Error('Invalid preview URL.');$('#live-frame').src=url.href;$('#live-frame').hidden=false;$('#preview-message').hidden=true;}catch(e){if(generation===version)$('#preview-message').textContent=e.message;}
}
async function runAction(action,payload) {
  if(operation||!active)return;operation=true;controls();const id=active.id,generation=version;
  try{const result=await api(`/apps/${id}/${action}`,{method:'POST',body:payload,requestId:crypto.randomUUID()});if(generation!==version)return;if(action==='publish'){status('Published. Retrieving your app link…');const published=await api(`/apps/${id}/published`);if(published.url){const u=new URL(published.url);if(u.protocol==='https:'){$('#published-link').href=u.href;$('#published-link').hidden=false;status('Your creation is published.');}}}else{$('#followup').value='';$('#live-frame').removeAttribute('src');$('#live-frame').hidden=true;status('Your request was sent. Watching the build…');}return result;}catch(e){if(generation===version)status(e.message);}finally{operation=false;if(generation===version){controls(active.status?.state);clearTimeout(timer);timer=setTimeout(()=>refresh(generation),7000)}}
}
async function answer(q,decision,value) {
  await runAction('answer',{tool_call_id:q.id,action:decision,...(value?{extra_user_input:value}:{})});
}
function showConnection(){$('#connection-error').textContent='';$('#connect-dialog').showModal();}
export const studio={
  get ready(){return !!accessKey},
  init({navigate,saveApp}){
    go=navigate;onApp=saveApp;
    try{$('#backend-url').value=localStorage.getItem('boo-backend')||'https://boo-studio-backend.onrender.com'}catch{}
    if(location.hostname==='localhost'||location.hostname==='127.0.0.1')$('#backend-url').value=location.origin;
    $('#studio-key-file').onchange=async e=>{
      try{const file=e.target.files[0];if(!file||file.size>4096)throw Error('Choose your studio access file.');const config=JSON.parse(await file.text());
      if(config.backend!=='https://boo-studio-backend.onrender.com'||typeof config.key!=='string'||config.key.length<24)throw Error('Invalid studio access file.');
      $('#backend-url').value=config.backend;$('#studio-key').value=config.key;$('#connection-error').textContent='';$('#connect-form').requestSubmit();
      }catch(error){$('#connection-error').textContent=error.message}finally{e.target.value=''}
    };
    $('#connect-builder').onclick=showConnection;$('#close-connect').onclick=()=>$('#connect-dialog').close();
    $('#connect-form').onsubmit=async e=>{e.preventDefault();$('#connection-error').textContent='';$('#connect-submit').disabled=true;
      try{version++;clearTimeout(timer);backend=origin($('#backend-url').value);accessKey=$('#studio-key').value;const health=await api('/health');if(!health.configured)throw Error('Your backend is missing its Base44 workspace, token, or studio key.');const data=await api('/apps');for(const app of data.apps)onApp({...app,remote:true});try{localStorage.setItem('boo-backend',backend);sessionStorage.setItem('boo-session',JSON.stringify({backend,key:accessKey}))}catch{}$('#connect-builder').textContent='Studio unlocked';$('#studio-key').value='';$('#connect-dialog').close();}
      catch(e){accessKey='';$('#connection-error').textContent=e.message;$('#connect-builder').textContent='Unlock studio';}
      finally{$('#connect-submit').disabled=false;}
    };
    $('#disconnect-builder').onclick=()=>{try{sessionStorage.removeItem('boo-session')}catch{}accessKey='';version++;clearTimeout(timer);$('#live-frame').removeAttribute('src');$('#live-frame').hidden=true;$('#build-messages').replaceChildren();$('#build-questions').replaceChildren();$('#studio-key').value='';$('#connect-builder').textContent='Unlock studio';$('#connect-dialog').close();go('home')};
    try{const saved=JSON.parse(sessionStorage.getItem('boo-session')||'null');if(saved?.backend==='https://boo-studio-backend.onrender.com'&&typeof saved.key==='string'){
      $('#backend-url').value=saved.backend;$('#studio-key').value=saved.key;
      $('#connect-builder').textContent='Connecting…';queueMicrotask(()=>$('#connect-form').requestSubmit());
    }}catch{}
    $('#followup-form').onsubmit=e=>{e.preventDefault();const value=$('#followup').value.trim();if(value)runAction('chat',{content:value})};
    $('#refresh-preview').onclick=()=>loadPreview();$('#publish-app').onclick=()=>$('#publish-dialog').showModal();$('#cancel-publish').onclick=()=>$('#publish-dialog').close();$('#confirm-publish').onclick=()=>{$('#publish-dialog').close();runAction('publish',{confirm:true})};
    $('#older-messages').onclick=async()=>{const generation=version;try{skip+=20;const data=await api(`/apps/${active.id}/messages?skip=${skip}`);if(generation!==version)return;messages=new Map([...data.messages.map(m=>[m.id,m]),...messages]);drawMessages();$('#older-messages').hidden=!data.hasMore}catch(e){skip=Math.max(0,skip-20);status(e.message)}};
  },
  async create(prompt,name){
    if(!accessKey){showConnection();return;}if(operation)return;
    version++;clearTimeout(timer);go('builder-view');active=null;waiting=[];messages.clear();drawMessages();drawQuestions();$('#build-name').textContent=name;$('#live-frame').hidden=true;$('#live-frame').removeAttribute('src');$('#published-link').hidden=true;status('Starting your creation. This can take a couple of minutes…');operation=true;controls();
    try{const app=await api('/apps',{method:'POST',body:{prompt,name},requestId:crypto.randomUUID()});onApp({...app,remote:true});await this.open({...app,remote:true});}
    catch(e){status(e.message)}finally{operation=false;controls(active?.status?.state)}
  },
  async open(app){
    if(!accessKey){showConnection();return;}version++;clearTimeout(timer);active=app;messages.clear();waiting=[];skip=0;drawMessages();drawQuestions();go('builder-view');$('#build-name').textContent=app.name||app.title;$('#live-frame').hidden=true;$('#live-frame').removeAttribute('src');$('#published-link').hidden=true;status('Loading your creation…');controls();await refresh(version);
  },
  pause(){version++;clearTimeout(timer);$('#live-frame').removeAttribute('src');$('#live-frame').hidden=true;}
};
