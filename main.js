const $=s=>document.querySelector(s);
const message=(role,value)=>{const card=document.createElement('div');card.className=`chat-message ${role}`;const name=document.createElement('b'),body=document.createElement('p');name.textContent=role==='user'?'You':'Boo Studio';body.textContent=value;card.append(name,body);$('#build-messages').append(card)};
let drafts=[],active=null;
try{for(const key of ['boo-session','boo-backend','boo-drafts']){localStorage.removeItem(key);sessionStorage.removeItem(key)}drafts=JSON.parse(localStorage.getItem('boo-ui-drafts')||'[]')}catch{}
function view(library=false){$('#library').hidden=!library;$('#builder-view').hidden=library;$('#crumb').textContent=library?'My ideas':'App creator';$('#create-nav').classList.toggle('selected',!library);$('#creations-nav').classList.toggle('selected',library)}
function render(){
 $('#count').textContent=drafts.length;$('#recent-list').replaceChildren();$('#library-items').replaceChildren();
 if(!drafts.length){const p=document.createElement('p');p.className='no-recent';p.textContent='Your ideas will appear here.';$('#recent-list').append(p)}
 for(const draft of drafts){for(const [host,className] of [['#recent-list','recent-item'],['#library-items','library-card']]){const button=document.createElement('button');button.className=className;button.textContent='✧ '+draft.title;button.onclick=()=>open(draft);$(host).append(button)}}
}
function open(draft=null){active=draft;view();$('#build-name').textContent=draft?.title||'Let’s make something spooky.';$('#followup').value='';$('#build-messages').replaceChildren();message('assistant','What would you like to build? Explore the chat interface and save your ideas here. This is a UI demo; it does not generate apps.');for(const value of draft?.messages||[])message('user',value);
 if(!draft)for(const [label,prompt] of [['🎃 Party planner','A Halloween party planner with invitations and a countdown.'],['👻 Costume quiz','A fun Halloween costume quiz with personalized recommendations.'],['🍬 Candy tracker','A trick-or-treat candy tracker with a checklist and ratings.']]){const button=document.createElement('button');button.className='chat-suggestion';button.textContent=label;button.onclick=()=>{$('#followup').value=prompt;$('#followup').focus()};$('#build-messages').append(button)}
}
$('#followup-form').onsubmit=e=>{e.preventDefault();const value=$('#followup').value.trim();if(!value)return;if(!active){active={id:crypto.randomUUID(),title:value.slice(0,46),messages:[]};drafts.unshift(active)}active.messages.push(value);drafts=drafts.slice(0,50);try{localStorage.setItem('boo-ui-drafts',JSON.stringify(drafts))}catch{}open(active);message('assistant','Idea saved in this browser. App generation is not connected in this UI demo.');render()};
$('#followup').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){$('#followup-form').requestSubmit();e.preventDefault()}});
$('#new').onclick=()=>open();$('#create-nav').onclick=()=>open();$('#creations-nav').onclick=()=>view(true);
$('#about').onclick=()=>$('#about-dialog').showModal();$('#close-dialog').onclick=()=>$('#about-dialog').close();
render();open();
