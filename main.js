import {studio} from './builder.js?v=direct5';
const $=s=>document.querySelector(s);
let apps=[];try{apps=JSON.parse(localStorage.getItem('boo-drafts')||'[]').filter(a=>a.remote&&a.id)}catch{}
function view(name){for(const id of ['home','draft-view','library','builder-view']){const el=$('#'+id);if(el)el.hidden=id!==name}$('#crumb').textContent=name==='library'?'My apps':'App creator';$('#create-nav').classList.toggle('selected',name!=='library');$('#creations-nav').classList.toggle('selected',name==='library');}
function render(){
 $('#count').textContent=apps.length;$('#recent-list').replaceChildren();$('#library-items').replaceChildren();
 if(!apps.length){const p=document.createElement('p');p.className='no-recent';p.textContent='Your apps will appear here.';$('#recent-list').append(p)}
 for(const app of apps){const button=document.createElement('button');button.className='recent-item';button.textContent='✧ '+app.title;button.onclick=()=>studio.open(app);if($('#recent-list').children.length<8)$('#recent-list').append(button);const card=button.cloneNode(true);card.className='library-card';card.onclick=()=>studio.open(app);$('#library-items').append(card)}
}
studio.init({navigate:view,saveApp:app=>{const previous=apps.find(x=>x.id===app.id);const saved={id:app.id,title:app.name||app.title||previous?.title||'Untitled app',prompt:app.prompt||previous?.prompt||'',remote:true,status:app.status};apps=[saved,...apps.filter(x=>x.id!==app.id)].slice(0,50);try{localStorage.setItem('boo-drafts',JSON.stringify(apps))}catch{}render();}});
$('#new').onclick=()=>studio.new();$('#create-nav').onclick=()=>studio.new();$('#creations-nav').onclick=()=>{studio.pause();render();view('library')};
$('#about').onclick=()=>$('#about-dialog').showModal();$('#close-dialog').onclick=()=>$('#about-dialog').close();
$('#followup').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter')$('#followup-form').requestSubmit()});
render();studio.new();
