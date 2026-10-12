import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Base44,previewURL} from '../server/base44.mjs';
import {Store} from '../server/store.mjs';
import {createApp} from '../server/app.mjs';
const key='test-studio-key-long-enough-for-auth';
const workspace='workspace-test';
const app={id:'app-test',name:'Fright night',organization_id:workspace,public_settings:'private_with_login',status:{state:'ready'}};
async function fixture(t,fetchImpl){
  const dir=await mkdtemp(join(tmpdir(),'boo-test-'));const store=await new Store(join(dir,'state.json')).init();
  const client=new Base44({token:'test-private-pat',workspaceId:workspace,fetchImpl});
  const server=createApp({client,store,adminKey:key,allowedOrigins:['https://talevy25.github.io'],staticDir:resolve('dist')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})});
  return {store,client,url:`http://127.0.0.1:${server.address().port}`,async call(path,{method='GET',body,id,auth=true,origin}={}){const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{...(auth?{Authorization:`Bearer ${key}`} : {}),...(body?{'Content-Type':'application/json'}:{}),...(id?{'X-Request-ID':id}:{}),...(origin?{Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),headers:r.headers}}};
}
const ok=data=>new Response(JSON.stringify(data),{status:200});
test('server credentials and exact workspace are used; duplicate creation is not replayed',async t=>{
  const calls=[];const f=await fixture(t,async(url,options)=>{calls.push({url,options});return ok(app)});
  const result=await f.call('/apps',{method:'POST',id:'create-1',body:{prompt:'Make a Halloween party app',name:'Fright night'}});
  assert.equal(result.status,201);assert.equal(calls.length,1);
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-private-pat');assert.equal(calls[0].options.headers['X-Active-Workspace-Id'],workspace);
  const payload=JSON.parse(calls[0].options.body);assert.equal(payload.organization_id,workspace);assert.equal(payload.initial_message.content,'Make a Halloween party app');assert.equal(payload.public_settings,undefined);
  assert(!JSON.stringify(result.data).includes('test-private-pat'));
  const replay=await f.call('/apps',{method:'POST',id:'create-1',body:{prompt:'Make a Halloween party app',name:'Fright night'}});assert.equal(replay.status,201);assert.equal(calls.length,1);
  const conflict=await f.call('/apps',{method:'POST',id:'create-1',body:{prompt:'Different app',name:'Other'}});assert.equal(conflict.status,409);
});
test('unauthorized callers and unrelated apps cannot reach Base44',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;return ok(app)});
  assert.equal((await f.call('/apps',{auth:false})).status,401);
  assert.equal((await f.call('/apps/another-app')).status,404);
  assert.equal((await f.call('/apps',{origin:'https://evil.example'})).status,403);assert.equal(calls,0);
});
test('uncertain creation is recorded durably and cannot be automatically repeated',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;throw Error('network')});const options={method:'POST',id:'create-uncertain',body:{prompt:'Create spooky app',name:'Boo'}};
  assert.equal((await f.call('/apps',options)).data.code,'result_unknown');assert.equal((await f.call('/apps',options)).status,409);assert.equal(calls,1);
  const restored=await new Store(f.store.path).init();assert.equal(restored.data.requests['create-uncertain'].state,'unknown');
});
test('questions block chat, can be declined, and submit retries use stable IDs',async t=>{
  const calls=[];const f=await fixture(t,async(url,options)=>{calls.push({url,options});if(url.includes('full-conversation'))return ok({messages:[{id:'m',role:'assistant',tool_calls:[{id:'tool-1',status:'waiting_for_user_input',waiting_on:{kind:'approval'},arguments_string:'{"action":"review"}'}]}]});return ok(app)});
  f.store.data.apps[app.id]=app;
  const blocked=await f.call('/apps/app-test/chat',{method:'POST',id:'chat-1',body:{content:'Ignore the question'}});assert.equal(blocked.status,409);
  const options={method:'POST',body:{tool_call_id:'tool-1',action:'rejected'}};
  assert.equal((await f.call('/apps/app-test/answer',options)).status,200);
  assert.equal((await f.call('/apps/app-test/answer',options)).status,200);
  const submissions=calls.filter(c=>c.url.includes('submit-tool-call-input'));assert.equal(submissions.length,1);assert.equal(submissions[0].options.headers['X-Request-ID'],'answer-app-test-tool-1');assert.equal(JSON.parse(submissions[0].options.body).action,'rejected');
});
test('conversation is paged, waiting action is reviewable, and nonwaiting tool payloads are removed',async t=>{
  let requested;const f=await fixture(t,async url=>{requested=url;return ok({messages:[{id:'m',role:'assistant',content:'Question',tool_calls:[{id:'wait',status:'waiting_for_user_input',waiting_on:{kind:'input'},arguments_string:'{"question":"Choose a title"}'},{id:'finished',status:'success',arguments_string:'large source'}]}]})});f.store.data.apps[app.id]=app;
  const result=await f.call('/apps/app-test/messages?skip=20');assert(requested.endsWith('limit=20&skip=20'));assert.equal(result.data.messages[0].tool_calls.length,1);assert(result.data.messages[0].tool_calls[0].arguments_string.includes('Choose a title'));
});
test('preview token is short-lived response data and never stored',async t=>{
  const f=await fixture(t,async()=>ok({preview_url:'preview.example/path?x=1',preview_token:'ephemeral',sandbox_info:{cold_start:true}}));f.store.data.apps[app.id]=app;
  const result=await f.call('/apps/app-test/preview');const u=new URL(result.data.url);assert.equal(u.searchParams.get('x'),'1');assert.equal(u.searchParams.get('_preview_token'),'ephemeral');assert.equal(result.headers.get('cache-control'),'no-store');assert(!JSON.stringify(f.store.data).includes('ephemeral'));
  assert.throws(()=>previewURL({preview_url:'javascript:alert(1)://example'}));
});
test('publish requires explicit confirmation and a ready build',async t=>{
  const calls=[];const f=await fixture(t,async(url,opts)=>{calls.push(url);return ok(url.includes('full-conversation')?{messages:[]}:app)});f.store.data.apps[app.id]=app;
  assert.equal((await f.call('/apps/app-test/publish',{method:'POST',id:'publish-1',body:{}})).status,400);
  assert.equal((await f.call('/apps/app-test/publish',{method:'POST',id:'publish-2',body:{confirm:true}})).status,200);
  assert.equal(calls.filter(url=>url.endsWith('/deploy')).length,1);
});
test('server never serves private files',async t=>{
  const f=await fixture(t,async()=>ok({}));for(const path of ['/server/start.mjs','/.env','/data/studio.json'])assert.equal((await fetch(f.url+path)).status,404);
});
test('a waiting input can resume a processing app with extra_user_input',async t=>{
  let submitted;const f=await fixture(t,async(url,options)=>{
    if(url.includes('full-conversation'))return ok({messages:[{id:'m',tool_calls:[{id:'input-1',status:'waiting_for_user_input',waiting_on:{kind:'input'}}]}]});
    if(url.includes('submit-tool-call-input'))submitted=JSON.parse(options.body);
    return ok({...app,status:{state:'processing'}});
  });f.store.data.apps[app.id]=app;
  const result=await f.call('/apps/app-test/answer',{method:'POST',body:{tool_call_id:'input-1',action:'approved',extra_user_input:'Pumpkin party'}});
  assert.equal(result.status,200);assert.equal(submitted.extra_user_input,'Pumpkin party');
});
