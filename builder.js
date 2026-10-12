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
}
function drawMessages() {
  const container=$('#build-messages');container.replaceChildren();
  for(const m of messages.values()){if(!m.content||m.hidden)continue;const card=text('div','',`chat-message ${m.role==='user'?'user':'assistant'}`);card.append(text('b',m.role==='user'?'You':'Boo Studio'),text('p',m.content));container.append(card)}
}
function drawQuestions() {
  const host=$('#build-questions');host.replaceChildren();
  for(const q of waiting){
    const card=text('div','','agent-question');const kind=q.waiting_on?.kind;card.append(text('h3','A little input needed'),text('p',q.name||'Builder question'));
    // Render the exact action/question as text, never executable markup.
    const detail=text('pre',JSON.stringify({request:q.waiting_on,arguments:q.arguments_string},null,2));card.append(detail);
    let input;
    let args={};try{args=JSON.parse(q.arguments_string||'{}')}catch{}
    const options=q.waiting_on?.options||args.options;
    if(kind==='choice'&&Array.isArray(options)&&options.length&&options.every(x=>typeof x==='string')){
      input=document.createElement('select');input.setAttribute('aria-label','Your choice');for(const option of options){const el=document.createElement('option');el.value=option;el.textContent=option;input.append(el)}card.append(input);
    }else if(kind==='choice'||kind==='input'){
      input=document.createElement('textarea');input.setAttribute('aria-label',kind==='choice'?'Your choice':'Your answer');input.maxLength=8000;input.placeholder=kind==='choice'?'Enter the option you choose from the request above':'Enter the requested value';card.append(input);
    }
    if(!['choice','input','approval'].includes(kind)){card.append(text('p','This question format needs attention in Base44.'));host.append(card);continue;}
    const actions=text('div','','dialog-actions');for(const decision of ['approved','rejected']){const b=text('button',decision==='approved'?(kind==='approval'?'Approve':'Send answer'):'Decline',decision==='approved'?'conjure':'secondary');b.onclick=()=>answer(q,decision,input?.value||'');actions.append(b)}card.append(actions);host.append(card);
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
    status(waiting.length?'The builder is waiting for your answer.':labels[app.status.state]||'Checking the build…');
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
  if(decision==='approved'&&q.waiting_on.kind!=='approval'&&!value.trim()){status('Add your answer first.');return;}
  await runAction('answer',{tool_call_id:q.id,action:decision,...(value?{extra_user_input:value}:{})});
}
function showConnection(){$('#connection-error').textContent='';$('#connect-dialog').showModal();}
export const studio={
  get ready(){return !!accessKey},
  init({navigate,saveApp}){
    go=navigate;onApp=saveApp;
    try{$('#backend-url').value=localStorage.getItem('boo-backend')||''}catch{}
    if(location.hostname==='localhost'||location.hostname==='127.0.0.1')$('#backend-url').value=location.origin;
    $('#connect-builder').onclick=showConnection;$('#close-connect').onclick=()=>$('#connect-dialog').close();
    $('#connect-form').onsubmit=async e=>{e.preventDefault();$('#connection-error').textContent='';$('#connect-submit').disabled=true;
      try{version++;clearTimeout(timer);backend=origin($('#backend-url').value);accessKey=$('#studio-key').value;const health=await api('/health');if(!health.configured)throw Error('Your backend is missing its Base44 workspace, token, or studio key.');const data=await api('/apps');for(const app of data.apps)onApp({...app,remote:true});try{localStorage.setItem('boo-backend',backend)}catch{}$('#connect-builder').textContent='Builder connected';$('#studio-key').value='';$('#connect-dialog').close();}
      catch(e){accessKey='';$('#connection-error').textContent=e.message;$('#connect-builder').textContent='Connect builder';}
      finally{$('#connect-submit').disabled=false;}
    };
    $('#disconnect-builder').onclick=()=>{accessKey='';version++;clearTimeout(timer);$('#live-frame').removeAttribute('src');$('#live-frame').hidden=true;$('#build-messages').replaceChildren();$('#build-questions').replaceChildren();$('#studio-key').value='';$('#connect-builder').textContent='Connect builder';$('#connect-dialog').close();go('home')};
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
