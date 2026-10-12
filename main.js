const $=s=>document.querySelector(s);
const el=(tag,props={},...children)=>{const node=Object.assign(document.createElement(tag),props);node.append(...children);return node};
const api=async(path,body)=>{const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(data.error||'Something went wrong.'),{status:response.status});return data};
const SUGGESTIONS=[['🎃 Party planner','A Halloween party planner with invitations and a countdown.'],['👻 Costume quiz','A fun Halloween costume quiz with personalized recommendations.'],['🍬 Candy tracker','A trick-or-treat candy tracker with a checklist and ratings.']];
let follow=true,apps=[],active=null,configured=false,timer=null,older=[],olderSkip=0,latest=[],waiting=false,app=null,previewFor=null,pendingCreate=null;

function toast(text){const t=$('#toast');t.textContent=text;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),3500)}
function status(text){$('#build-status').textContent=text}
function view(library=false){$('#library').hidden=!library;$('#builder-view').hidden=library;$('#crumb').textContent=library?'My ideas':'App creator';$('#create-nav').classList.toggle('selected',!library);$('#creations-nav').classList.toggle('selected',library)}

function renderApps(){
 $('#count').textContent=apps.length;$('#recent-list').replaceChildren();$('#library-items').replaceChildren();
 if(!apps.length)$('#recent-list').append(el('p',{className:'no-recent',textContent:'Your creations will haunt this space.'}));
 for(const item of apps)for(const [host,className] of [['#recent-list','recent-item'],['#library-items','library-card']])$(host).append(el('button',{className,textContent:'✧ '+(item.name||'Untitled creation'),onclick:()=>open(item.id)}));
}
async function loadApps(){try{apps=(await api('/api/apps')).apps}catch{apps=[]}renderApps()}

function message(role,value){const card=el('div',{className:`chat-message ${role}`},el('b',{textContent:role==='user'?'You':'Boo Studio'}),el('p',{textContent:value}));$('#build-messages').append(card)}

function lock(){const locked=!configured||waiting||(active&&(app?.busy||app?.state==='processing'));$('#followup').disabled=locked;$('#send-followup').disabled=locked;$('#followup').placeholder=waiting?'Answer the question above to keep building…':locked&&active?'Boo Studio is conjuring…':'Add a little more magic…'}

function start(){
 clearInterval(timer);active=null;app=null;older=[];latest=[];waiting=false;previewFor=null;view();
 $('#build-name').textContent='Let’s make something spooky.';$('#build-messages').replaceChildren();$('#build-questions').replaceChildren();$('#older-messages').hidden=true;
 message('assistant','What would you like to build? Describe your idea and I’ll conjure it up, then you can keep tweaking it here.');
 for(const [label,prompt] of SUGGESTIONS)$('#build-messages').append(el('button',{className:'chat-suggestion',textContent:label,onclick:()=>{$('#followup').value=prompt;$('#followup').focus()}}));
 $('#publish-app').disabled=true;$('#refresh-preview').disabled=true;$('#published-link').hidden=true;resetPreview('Your app preview will appear here once it’s built.');
 status(configured?'Describe an app to start building':'The builder isn’t connected yet. Ask the studio owner to finish setup.');lock();
}

async function open(id){
 clearInterval(timer);active=id;app=null;older=[];olderSkip=0;latest=[];waiting=false;previewFor=null;view();
 $('#build-name').textContent=apps.find(a=>a.id===id)?.name||'Your creation';$('#build-messages').replaceChildren();$('#build-messages').dataset.signature='';follow=true;$('#build-questions').replaceChildren();
 $('#published-link').hidden=true;resetPreview('Loading your preview…');status('Summoning your app…');lock();
 api(`/api/apps/${id}/published`).then(r=>showPublished(r.url)).catch(()=>{});
 await tick();timer=setInterval(tick,3000);
}

async function tick(){
 const id=active;if(!id)return;
 try{
  const [state,page]=await Promise.all([api(`/api/apps/${id}`),api(`/api/apps/${id}/messages`)]);if(id!==active)return;
  app=state;latest=page.messages;if(!older.length&&!olderSkip)$('#older-messages').hidden=!page.more;
  if(state.name){$('#build-name').textContent=state.name;const known=apps.find(a=>a.id===id);if(known&&known.name!==state.name){known.name=state.name;renderApps()}}
  renderConversation();
  const working=state.busy||state.state==='processing';
  status(state.outOfCredits?'The studio is out of credits. Ask the studio owner to add more, then send your message again.':waiting?'Boo Studio has a question for you':working?'Conjuring your app… this can take a few minutes':state.error?state.error:state.state==='error'?'That build didn’t work. Try describing the change again.':'Ready ✦ Ask for a change or publish it');
  $('#publish-app').disabled=working||waiting||state.state!=='ready';$('#refresh-preview').disabled=working;
  if(!working&&state.state==='ready'&&previewFor!==lastMessageId())loadPreview();
  if(working&&previewFor===null)resetPreview('Your preview will appear when the first build is ready.');
 }catch(error){if(id===active)status(error.message)}
 lock();
}

function lastMessageId(){return latest.at(-1)?.id||'none'}

function renderConversation(){
 const seen=new Set(),all=[...older,...latest].filter(m=>!seen.has(m.id)&&seen.add(m.id));
 const box=$('#build-messages'),signature=all.map(m=>m.id+':'+m.content.length).join();
 if(box.dataset.signature!==signature){const top=box.scrollTop;box.dataset.signature=signature;box.replaceChildren();for(const m of all)if(m.content.trim())message(m.role,m.content);box.scrollTop=follow?box.scrollHeight:top}
 const questions=latest.flatMap(m=>m.questions);waiting=questions.length>0;
 const host=$('#build-questions'),ids=questions.map(q=>q.id).join();
 if(host.dataset.ids!==ids){host.dataset.ids=ids;host.replaceChildren(...questions.map(question))}
}

function optionsOf(q){const source=q.waitingOn?.options||q.args?.options||q.args?.choices||[];return Array.isArray(source)?source.map(o=>typeof o==='string'?o:o?.label||o?.value||o?.text).filter(Boolean):[]}
function promptOf(q){return q.waitingOn?.prompt||q.waitingOn?.question||q.args?.question||q.args?.prompt||q.args?.message||q.args?.description||''}

function question(q){
 const form=el('form',{className:'agent-question'}),options=optionsOf(q),kind=q.kind==='choice'||(!q.waitingOn&&options.length)?'choice':q.kind;
 form.append(el('b',{textContent:kind==='approval'?'Boo Studio wants to go ahead with a step':'Boo Studio has a question'}));
 const prompt=promptOf(q);if(prompt)form.append(el('p',{textContent:prompt}));
 let read=()=>'';
 if(kind==='choice'&&options.length){const set=el('fieldset',{},el('legend',{textContent:'Pick one'}));options.forEach((o,i)=>set.append(el('label',{className:'question-option'},el('input',{type:'radio',name:'pick',value:o,checked:i===0}),o)));form.append(set);read=()=>form.querySelector('input[name=pick]:checked')?.value||''}
 else if(kind==='input'){const secret=/key|token|secret|password/i.test(prompt+JSON.stringify(q.waitingOn||{}));const input=secret?el('input',{type:'password',autocomplete:'off'}):el('textarea',{rows:3});form.append(el('label',{},secret?'Value (sent straight to your app, not shown in chat)':'Your answer',input));read=()=>input.value.trim()}
 else if(!prompt){form.append(el('details',{},el('summary',{textContent:'What it wants to do'}),el('pre',{textContent:`${q.tool||'step'}\n${JSON.stringify(q.args,null,2)}`})))}
 const approve=el('button',{className:'conjure',type:'submit',textContent:kind==='approval'?'Approve ✦':'Send answer ✦'});
 const decline=el('button',{className:'secondary',type:'button',textContent:'Decline'});
 form.append(el('div',{className:'question-actions'},approve,decline));
 const answer=async action=>{const value=read();if(action==='approved'&&kind!=='approval'&&!value){toast('Add an answer first, or decline.');return}approve.disabled=decline.disabled=true;
  try{await api(`/api/apps/${active}/answers`,{toolCallId:q.id,action,answer:action==='approved'?value:''});form.replaceChildren(el('p',{textContent:action==='approved'?'Answer sent ✦ Back to building…':'Declined. Boo Studio will carry on without it.'}));app={...app,busy:true};lock()}
  catch(error){toast(error.message);approve.disabled=decline.disabled=false}};
 form.onsubmit=e=>{e.preventDefault();answer('approved')};decline.onclick=()=>answer('rejected');
 return form;
}

function resetPreview(text){previewFor=null;$('.live-preview iframe')?.remove();$('#preview-message').hidden=false;$('#preview-message').textContent=text}
async function loadPreview(){
 const id=active,marker=lastMessageId();previewFor=marker;$('#preview-message').hidden=false;$('#preview-message').textContent='Waking up your preview…';
 try{const {url,coldStart}=await api(`/api/apps/${id}/preview`);if(id!==active)return;
  let frame=$('#live-frame');if(!frame){frame=el('iframe',{id:'live-frame',title:'App preview'});frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-popups allow-modals');$('.live-preview').append(frame)}
  frame.src=url;$('#preview-message').hidden=true;if(coldStart)toast('Preview woke up from a nap — it may take a moment to load.');
 }catch(error){if(id===active){previewFor=marker;$('#preview-message').textContent=error.status===409?'The preview couldn’t start because the app has a build problem. Ask Boo Studio to fix it.':'The preview isn’t available right now. Try Refresh preview.'}}
}

function showPublished(url){const link=$('#published-link');if(!url){link.hidden=true;return}link.href=url;link.hidden=false}

$('#followup-form').onsubmit=async e=>{
 e.preventDefault();const content=$('#followup').value.trim();if(!content||$('#followup').disabled)return;
 $('#send-followup').disabled=true;
 try{
  if(!active){
   pendingCreate=pendingCreate?.prompt===content?pendingCreate:{prompt:content,requestId:crypto.randomUUID()};status('Starting your build…');
   const created=await api('/api/apps',pendingCreate);pendingCreate=null;$('#followup').value='';
   if(!apps.some(a=>a.id===created.id))apps.unshift(created);renderApps();await open(created.id);
  }else{
   await api(`/api/apps/${active}/messages`,{content,requestId:crypto.randomUUID()});$('#followup').value='';
   latest=[...latest,{id:'local-'+Date.now(),role:'user',content,questions:[]}];app={...app,busy:true};follow=true;renderConversation();status('Conjuring your change…');
  }
 }catch(error){toast(error.message);status(error.message)}
 lock();
};
$('#followup').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){$('#followup-form').requestSubmit();e.preventDefault()}});
$('#older-messages').onclick=async()=>{const id=active;olderSkip+=30;try{const page=await api(`/api/apps/${id}/messages?skip=${olderSkip}`);if(id!==active)return;older=[...page.messages,...older];$('#older-messages').hidden=!page.more;follow=false;renderConversation();$('#build-messages').scrollTop=0}catch(error){toast(error.message)}};
$('#build-messages').addEventListener('scroll',e=>{const b=e.target;follow=b.scrollHeight-b.scrollTop-b.clientHeight<80},{passive:true});
$('#refresh-preview').onclick=()=>active&&loadPreview();
$('#publish-app').onclick=async()=>{const button=$('#publish-app');button.disabled=true;button.textContent='Publishing…';try{const {url}=await api(`/api/apps/${active}/publish`,{});showPublished(url);toast('Your app is live ✦')}catch(error){toast(error.message)}button.textContent='Publish ↗';button.disabled=false};
$('#new').onclick=start;$('#create-nav').onclick=start;$('#creations-nav').onclick=()=>view(true);
$('#about').onclick=()=>$('#about-dialog').showModal();$('#close-dialog').onclick=()=>$('#about-dialog').close();
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.target.closest('input,textarea,button,select')&&!$('#about-dialog').open)start()});

try{for(const key of ['boo-session','boo-backend','boo-drafts','boo-ui-drafts']){localStorage.removeItem(key);sessionStorage.removeItem(key)}}catch{}
api('/api/health').then(h=>{configured=h.configured}).catch(()=>{}).finally(async()=>{await loadApps();start()});
