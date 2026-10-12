import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteStore} from '../server/remote-store.mjs';
test('remote store persists through restart and marks interrupted mutations unknown',async()=>{
 let payload=JSON.stringify({apps:{a:{id:'a'}},requests:{r:{state:'running'}}});
 const client={request:async(path,input)=>{if(input)payload=input.body.payload;return {payload}}};
 const a=await new RemoteStore(client,'a'.repeat(24),'b'.repeat(24)).init();
 assert.equal(a.data.requests.r.state,'unknown');a.data.apps.b={id:'b'};await a.save();
 const b=await new RemoteStore(client,'a'.repeat(24),'b'.repeat(24)).init();assert.equal(b.data.apps.b.id,'b');
});
test('failed remote writes reject and subsequent writes can recover',async()=>{
 let fail=false,payload=JSON.stringify({apps:{},requests:{}});
 const client={request:async(path,input)=>{if(fail)throw Error('offline');if(input)payload=input.body.payload;return {payload}}};
 const s=await new RemoteStore(client,'a'.repeat(24),'b'.repeat(24)).init();fail=true;await assert.rejects(s.save());fail=false;await s.save();
});
