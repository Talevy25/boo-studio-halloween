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
  const locked=operation||waiting.length>0||state==='processing';
  $('#followup').disabled=locked;$('#send-followup').disabled=locked;
  $('#publish-app').disabled=locked||state!=='ready';$('#refresh-preview').disabled=operation||!active||state==='processing';
  document.querySelectorAll('#build-questions button').forEach(button=>button.disabled=operation);
}
function drawMessages() {
  const container=$('#build-messages');container.replaceChildren();
  for(const m of messages.values()){if(!m.content||m.hidden)continue;const card=text('div','',`chat-message ${m.role==='user'?'user':'assistant'}`);card.append(text('b',m.role==='user'?'You':'Boo Studio'),text('p',m.content));container.append(card)}
}
let connecting=null;
async function connect(){
  if(accessKey)return;
  if(connecting)return connecting;
  connecting=(async()=>{
    status('Connecting to your studio… The first visit may take a minute.');
    try{const saved=JSON.parse(localStorage.getItem('boo-session')||'null');if(saved?.backend===backend)accessKey=saved.key||''}catch{}
    if(accessKey){try{await api('/apps');return}catch{accessKey=''}}
    const response=await fetch(`${backend}/api/session`,{method:'POST',signal:AbortSignal.timeout(150000)});
    const data=await response.json();if(!response.ok||!data.token)throw Error(data.error||'Could not connect to your studio. Please try again.');
    accessKey=data.token;try{localStorage.setItem('boo-session',JSON.stringify({backend,key:accessKey}))}catch{}
  })();
  try{await connecting}finally{connecting=null}
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
export const studio={
  get ready(){return !!accessKey},
  init({navigate,saveApp,replaceApps}){
    go=navigate;onApp=saveApp;
    backend=['localhost','127.0.0.1'].includes(location.hostname)?location.origin:'https://boo-studio-backend.onrender.com';
    queueMicrotask(async()=>{try{await connect();const data=await api('/apps');replaceApps(data.apps);if(!active&&!operation)status('Describe your idea to start building.')}catch(e){status(e.message)}});
    $('#followup-form').onsubmit=e=>{e.preventDefault();const value=$('#followup').value.trim();if(value){if(active)runAction('chat',{content:value});else studio.create(value,value.replace(/^(create|build|make)\s+(an?\s+)?/i,'').slice(0,46)||'My Halloween app')}};
    $('#refresh-preview').onclick=()=>loadPreview();$('#publish-app').onclick=()=>$('#publish-dialog').showModal();$('#cancel-publish').onclick=()=>$('#publish-dialog').close();$('#confirm-publish').onclick=()=>{$('#publish-dialog').close();runAction('publish',{confirm:true})};
    $('#older-messages').onclick=async()=>{const generation=version;try{skip+=20;const data=await api(`/apps/${active.id}/messages?skip=${skip}`);if(generation!==version)return;messages=new Map([...data.messages.map(m=>[m.id,m]),...messages]);drawMessages();$('#older-messages').hidden=!data.hasMore}catch(e){skip=Math.max(0,skip-20);status(e.message)}};
  },
  new(){
    version++;clearTimeout(timer);active=null;waiting=[];messages.clear();drawQuestions();go('builder-view');
    $('#build-name').textContent='Let’s make something spooky.';$('#followup').value='';$('#followup').placeholder='Describe the app you want to build…';
    $('#live-frame').removeAttribute('src');$('#live-frame').hidden=true;$('#published-link').hidden=true;$('#older-messages').hidden=true;
    $('#preview-message').hidden=false;$('#preview-message').textContent='Your app will appear here. Start with a message in the chat.';
    status('Describe your idea to start building.');const host=$('#build-messages');host.replaceChildren();
    const welcome=text('div','','chat-message assistant');welcome.append(text('b','Boo Studio'),text('p','What would you like to build? Describe your idea, and I’ll turn it into a working app. You can ask for changes right here.'));host.append(welcome);
    for(const [label,prompt] of [['🎃 Party planner','Build a Halloween party planner with invitations, an RSVP list, and a countdown.'],['👻 Costume quiz','Build a fun Halloween costume quiz with personalized recommendations.'],['🍬 Candy tracker','Build a trick-or-treat candy tracker with a checklist and ratings.']]){const button=text('button',label,'chat-suggestion');button.onclick=()=>{$('#followup').value=prompt;$('#followup').focus()};host.append(button)}
    controls();
  },
  async create(prompt,name){
    if(operation)return;
    try{await connect()}catch(e){status(e.message);return;}if(operation)return;
    version++;clearTimeout(timer);go('builder-view');active=null;waiting=[];messages.clear();drawMessages();drawQuestions();$('#build-name').textContent=name;$('#live-frame').hidden=true;$('#live-frame').removeAttribute('src');$('#published-link').hidden=true;status('Creating your app…');messages.set('pending',{id:'pending',role:'user',content:prompt});drawMessages();$('#followup').value='';operation=true;controls();
    try{const app=await api('/apps',{method:'POST',body:{prompt,name},requestId:crypto.randomUUID()});onApp({...app,remote:true});await this.open({...app,remote:true});}
    catch(e){status(e.message)}finally{operation=false;controls(active?.status?.state)}
  },
  async open(app){
    try{await connect()}catch(e){status(e.message);return;}version++;clearTimeout(timer);active=app;messages.clear();waiting=[];skip=0;drawMessages();drawQuestions();go('builder-view');$('#build-name').textContent=app.name||app.title;$('#live-frame').hidden=true;$('#live-frame').removeAttribute('src');$('#published-link').hidden=true;status('Loading your creation…');controls();await refresh(version);
  },
  pause(){version++;clearTimeout(timer);$('#live-frame').removeAttribute('src');$('#live-frame').hidden=true;}
};
