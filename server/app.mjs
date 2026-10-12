import {answerPayload} from './answers.mjs';
import {createServer} from 'node:http';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ApiError,safeApp,safeMessages,previewURL} from './base44.mjs';
const hash=value=>createHash('sha256').update(value).digest();
const validId=value=>typeof value==='string' && /^[\w-]{1,160}$/.test(value);
const validateText=(value,max=12000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new ApiError(400,'Enter a valid prompt.');return value.trim()};
async function body(req) {
  if(!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415,'JSON is required.');
  let data=''; for await(const chunk of req) {data+=chunk;if(data.length>20000)throw new ApiError(413,'Request is too large.');}
  try{return JSON.parse(data)}catch{throw new ApiError(400,'Invalid JSON.');}
}
export function createApp({client,store,adminKey,allowedOrigins=[],staticDir=resolve('dist')}) {
  const busy=new Set(); let creating=false; 
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
  const owned=(id,owner)=>{if(!validId(id)||!Object.hasOwn(store.data.apps,id)||(owner&&store.data.apps[id].owner!==owner))throw new ApiError(404,'Creation not found.');};
  const sign=id=>createHmac('sha256',adminKey).update(id).digest('base64url');
  const scope=(key,owner)=>{if(!validId(key))throw new ApiError(400,'A valid request ID is required.');return owner?hash(owner+':'+key).toString('hex'):key};
  async function mutation(key,signature,run) {
    if(!validId(key))throw new ApiError(400,'A valid request ID is required.');
    const fingerprint=hash(signature).toString('hex');
    const existing=store.data.requests[key];
    if(existing && existing.state!=='failed') {
      if(existing.fingerprint!==fingerprint)throw new ApiError(409,'This request ID belongs to a different action.');
      if(existing.state==='done')return existing.result;
      throw new ApiError(409,existing.state==='running'?'This action is still running.':'The previous result is uncertain. Check the app in Base44 before starting another action.',existing.state==='running'?'in_progress':'result_unknown');
    }
    store.data.requests[key]={state:'running',fingerprint,date:Date.now()};await store.save();
    try {const result=await run();store.data.requests[key]={...store.data.requests[key],state:'done',result};await store.save();return result;}
    catch(e){store.data.requests[key].state=e.code==='result_unknown'?'unknown':'failed';await store.save();throw e;}
  }
  async function settled(id) {
    const app=await client.get(id);
    if(app.organization_id!==client.workspaceId)throw new ApiError(403,'This app is outside the configured workspace.');
    const transcript=await client.messages(id);
    const waiting=(transcript.messages||[]).flatMap(m=>(m.tool_calls||[]).map(t=>({...t,message_id:m.id}))).filter(t=>t.status==='waiting_for_user_input');
    return {app,waiting};
  }
  return createServer(async(req,res)=>{
    res.setHeader('Referrer-Policy','no-referrer');
    try {
      const url=new URL(req.url,'http://localhost');
      if(!url.pathname.startsWith('/api/')) {
        if(req.method!=='GET'&&req.method!=='HEAD')throw new ApiError(405,'Method not allowed.');
        const files={'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/style.css':['style.css','text/css'],'/main.js':['main.js','application/javascript'],'/builder.js':['builder.js','application/javascript']};
        const item=files[url.pathname];if(!item)throw new ApiError(404,'Not found.');
        const data=await readFile(resolve(staticDir,item[0]));res.writeHead(200,{'Content-Type':item[1],'X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);return;
      }
      const origin=req.headers.origin;
      if(origin&&!allowedOrigins.includes(origin))throw new ApiError(403,'This site is not allowed to use the builder.');
      if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, X-Request-ID','Access-Control-Max-Age':'600'});res.end();return;}
      if(url.pathname==='/api/health'&&req.method==='GET'){json(res,200,{service:'boo-studio',configured:!!(adminKey&&client.token&&client.workspaceId)});return;}
      if(!adminKey||adminKey.length<24)throw new ApiError(503,'Set a strong BOO_ADMIN_KEY on the server.','not_configured');
      if(url.pathname==='/api/session'&&req.method==='POST'){
        const id=randomUUID();json(res,201,{token:`guest.${id}.${sign(id)}`});return;
      }
      const auth=req.headers.authorization||'';
      let owner=null;
      if(!timingSafeEqual(hash(auth),hash(`Bearer ${adminKey}`))){
        const guest=auth.match(/^Bearer guest\.([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/);
        if(!guest||!timingSafeEqual(hash(guest[2]),hash(sign(guest[1]))))throw new ApiError(401,'Your studio session expired. Refresh to reconnect.','unauthorized');
        owner=guest[1];
      }
      if(url.pathname==='/api/apps'&&req.method==='GET'){json(res,200,{apps:Object.values(store.data.apps).filter(app=>!owner||app.owner===owner)});return;}
      if(url.pathname==='/api/apps'&&req.method==='POST'){
        const input=await body(req);const prompt=validateText(input.prompt);const name=validateText(input.name,100);const key=scope(req.headers['x-request-id'],owner);
        const result=await mutation(key,JSON.stringify({prompt,name}),async()=>{
          if(creating)throw new ApiError(409,'Another creation is being started. Please wait.');
          const recent=Object.values(store.data.requests).filter(r=>Date.now()-r.date<60000&&r.kind==='create');
          if(recent.length>=5)throw new ApiError(429,'Start at most five apps per minute.');
          creating=true;store.data.requests[key].kind='create';await store.save();
          try {
            const app=await client.create(prompt,name,key);
            if(!validId(app.id))throw new ApiError(502,'App creation returned no ID. Check Base44 before retrying.','result_unknown');
            // Preserve the mapping even if a configuration mismatch needs investigation.
            const saved={...safeApp(app),prompt,...(owner?{owner}:{})};store.data.apps[app.id]=saved;await store.save();
            if(app.organization_id!==client.workspaceId)throw new ApiError(502,'The created app is in an unexpected workspace. Check Base44 before retrying.','result_unknown');
            if(client.publicSettings && app.public_settings!==client.publicSettings)throw new ApiError(502,'App privacy settings did not apply. Review them in Base44.','result_unknown');
            return saved;
          }finally{creating=false;}
        });json(res,201,result);return;
      }
      const match=url.pathname.match(/^\/api\/apps\/([\w-]+)(?:\/(messages|chat|answer|preview|publish|published))?$/);
      if(!match)throw new ApiError(404,'Not found.');
      const [,id,action]=match;owned(id,owner);
      if(req.method==='GET'){
        if(!action){const app=await client.get(id);if(app.organization_id!==client.workspaceId)throw new ApiError(403,'Workspace mismatch.');const result=safeApp(app);store.data.apps[id]={...store.data.apps[id],...result};await store.save();json(res,200,result);return;}
        if(action==='messages'){const skip=Number(url.searchParams.get('skip')||0);if(!Number.isInteger(skip)||skip<0||skip>10000)throw new ApiError(400,'Invalid page.');const data=await client.messages(id,skip);json(res,200,{messages:safeMessages(data),hasMore:(data.messages||[]).length===20});return;}
        if(action==='preview'){const data=await client.preview(id);json(res,200,{url:previewURL(data),coldStart:!!data.sandbox_info?.cold_start});return;}
        if(action==='published'){try{json(res,200,await client.published(id))}catch(e){if(e.status===404)json(res,200,{url:null});else throw e}return;}
      }
      if(req.method!=='POST'||!['chat','answer','publish'].includes(action))throw new ApiError(405,'Method not allowed.');
      const input=await body(req);
      if(action==='chat')validateText(input.content);
      if(action==='answer'&&(!validId(input.tool_call_id)||!['approved','rejected'].includes(input.action)))throw new ApiError(400,'Invalid answer.');
      if(action==='publish'&&input.confirm!==true)throw new ApiError(400,'Confirm publication first.');
      const key=scope(action==='answer'?`answer-${id}-${input.tool_call_id}`:req.headers['x-request-id'],owner);
      const result=await mutation(key,JSON.stringify({id,action,input}),async()=>{
        if(busy.has(id))throw new ApiError(409,'An action is already running for this app.');busy.add(id);
        try {
          const {app,waiting}=await settled(id);
          if(action!=='answer'&&app.status?.state==='processing')throw new ApiError(409,'Wait for the current build to finish.');
          if(action!=='answer'&&waiting.length)throw new ApiError(409,'Answer the builder’s question first.');
          if(action==='chat')return safeApp(await client.chat(id,input.content,key));
          if(action==='answer'){
            const question=waiting.find(t=>t.id===input.tool_call_id);if(!question)throw new ApiError(409,'This question is no longer waiting.');
            if(!['choice','input','approval'].includes(question.waiting_on?.kind))throw new ApiError(409,'Open Base44 to answer this unsupported question.');
            const payload=answerPayload(question,input);
            return safeApp(await client.answer(id,payload,key));
          }
          if(app.status?.state!=='ready')throw new ApiError(409,'The app must be ready before publishing.');
          await client.deploy(id,key);return {published:true};
        }finally{busy.delete(id);}
      });json(res,200,result);
    }catch(e){json(res,e.status||500,{error:e.status?e.message:'The server could not complete the request.',code:e.code||'server_error'});}
  });
}
