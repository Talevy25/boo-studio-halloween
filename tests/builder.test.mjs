import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Base44} from '../server/base44.mjs';
import {createApp} from '../server/app.mjs';
import {CreateQueue} from '../server/queue.mjs';
import {Store} from '../server/store.mjs';

function fakeBase44() {
  const calls = [];
  const replies = {
    'POST /api/apps': () => ({id: `app${calls.filter(c => c.key === 'POST /api/apps').length}`, name: 'untitled', status: {state: 'processing'}}),
    'GET /api/apps/app1': () => ({id: 'app1', name: 'Pumpkin Party', status: {state: 'ready'}}),
    'GET /api/apps/app1/chat/full-conversation': () => ({messages: [
      {id: 'm1', role: 'user', content: 'Build it'},
      {id: 'm2', role: 'assistant', content: '', hidden: true},
      {id: 'm3', role: 'assistant', content: 'Which theme?', tool_calls: [{id: 'toolu_1', name: 'ask', status: 'waiting_for_user_input', arguments_string: '{"question":"Theme?","options":["Ghost","Witch"]}'}]}]}),
    'GET /api/apps/app1/sandbox/preview-url': () => ({preview_url: 'preview-app1.base44.app', preview_token: 'tok', sandbox_info: {cold_start: true, restored_from_snapshot: false}}),
    'POST /api/apps/app1/chat/message': () => ({status: {state: 'error', error_source: 'paywall'}}),
    'POST /api/apps/app1/chat/submit-tool-call-input': () => ({status: {state: 'ready'}})
  };
  const fetchImpl = async (url, init) => {
    const key = `${init.method} ${url.pathname}`;
    calls.push({key, url, headers: init.headers, body: init.body && JSON.parse(init.body)});
    const reply = replies[key];
    return reply ? new Response(JSON.stringify(reply()), {status: 200}) : new Response('{}', {status: 404});
  };
  return {calls, base44: new Base44({token: 'secret', workspaceId: 'ws1', fetchImpl, sleep: async () => {}})};
}

async function boot() {
  const {calls, base44} = fakeBase44();
  const server = createApp({base44, store: new Store(await mkdtemp(join(tmpdir(), 'boo-'))), queue: new CreateQueue(), log: {error() {}}});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const visitor = async () => {
    const res = await fetch(base + '/api/health');
    const cookie = res.headers.get('set-cookie').split(';')[0];
    return async (path, body) => {
      const r = await fetch(base + path, {headers: {cookie, ...(body ? {'Content-Type': 'application/json'} : {})}, method: body ? 'POST' : 'GET', body: body && JSON.stringify(body)});
      return {status: r.status, data: await r.json()};
    };
  };
  return {calls, server, visitor};
}

test('creates in the integration workspace, dedupes retried submits, and keeps visitors apart', async () => {
  const {calls, server, visitor} = await boot();
  try {
    const alice = await visitor(), bob = await visitor();
    const first = await alice('/api/apps', {prompt: 'A haunted house tour', requestId: 'req-1'});
    const retry = await alice('/api/apps', {prompt: 'A haunted house tour', requestId: 'req-1'});
    assert.equal(first.data.id, 'app1');
    assert.equal(retry.data.id, 'app1');
    const creates = calls.filter(c => c.key === 'POST /api/apps');
    assert.equal(creates.length, 1);
    assert.equal(creates[0].body.organization_id, 'ws1');
    assert.equal(creates[0].headers['X-Active-Workspace-Id'], 'ws1');
    assert.equal(creates[0].headers.Authorization, 'Bearer secret');
    assert.match(creates[0].body.custom_instructions, /Boo Studio/);

    assert.deepEqual((await alice('/api/apps')).data.apps.map(a => a.id), ['app1']);
    assert.deepEqual((await bob('/api/apps')).data.apps, []);
    assert.equal((await bob('/api/apps/app1')).status, 404);
    assert.equal((await bob('/api/apps/app1/preview')).status, 404);
    assert.equal(calls.filter(c => c.key === 'GET /api/apps/app1/sandbox/preview-url').length, 0);
  } finally { server.close(); }
});

test('surfaces questions, answers with a stable request ID, and builds a preview URL', async () => {
  const {calls, server, visitor} = await boot();
  try {
    const alice = await visitor();
    await alice('/api/apps', {prompt: 'Costume quiz', requestId: 'req-2'});
    const {data} = await alice('/api/apps/app1/messages');
    assert.deepEqual(data.messages.map(m => m.id), ['m1', 'm3']);
    assert.deepEqual(data.messages[1].questions[0].args.options, ['Ghost', 'Witch']);

    assert.equal((await alice('/api/apps/app1/answers', {toolCallId: 'toolu_1', action: 'approved', answer: 'Ghost'})).status, 200);
    await new Promise(r => setTimeout(r, 20));
    const submit = calls.find(c => c.key === 'POST /api/apps/app1/chat/submit-tool-call-input');
    assert.deepEqual(submit.body, {tool_call_id: 'toolu_1', action: 'approved', extra_user_input: 'Ghost'});
    assert.equal(submit.headers['X-Request-ID'], 'answer-toolu_1-approved');

    const preview = await alice('/api/apps/app1/preview');
    assert.equal(preview.data.url, 'https://preview-app1.base44.app/?_preview_token=tok');
  } finally { server.close(); }
});

test('reports an out-of-credits turn instead of a silent success', async () => {
  const {server, visitor} = await boot();
  try {
    const alice = await visitor();
    await alice('/api/apps', {prompt: 'Candy tracker', requestId: 'req-3'});
    await alice('/api/apps/app1/messages', {content: 'Add ratings', requestId: 'msg-1'});
    await new Promise(r => setTimeout(r, 20));
    const {data} = await alice('/api/apps/app1');
    assert.equal(data.busy, false);
    assert.match(data.error, /out of credits/);
  } finally { server.close(); }
});

test('create queue waits for a free slot instead of exceeding 5 per minute', async () => {
  let now = 0; const waits = [];
  const queue = new CreateQueue({now: () => now, sleep: async ms => { waits.push(ms); now += ms; }});
  const started = [];
  await Promise.all(Array.from({length: 7}, (_, i) => queue.run(async () => started.push([i, now]))));
  assert.equal(started.length, 7);
  assert.ok(started.slice(0, 5).every(([, t]) => t === 0));
  assert.ok(started[5][1] >= 60_000);
});
