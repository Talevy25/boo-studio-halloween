import {createServer} from 'node:http';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ApiError} from './base44.mjs';
import {customInstructions} from './instructions.mjs';

const STATIC = {'/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css'], '/main.js': ['main.js', 'text/javascript']};
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const PAGE = 30;

export function createApp({base44, store, queue, root = '.', log = console}) {
  const turns = new Map(); // appId -> {running, error} for send/submit calls still held open upstream
  const creating = new Map(); // requestId -> promise, so a double submit returns the same app

  function runTurn(appId, work) {
    if (turns.get(appId)?.running) throw new ApiError(409, 'Boo Studio is still working on the last step.', 'busy');
    const turn = {running: true, error: null};
    turns.set(appId, turn);
    work().then(result => {
      if (result?.queued) return;
      if (result?.status?.state === 'error') turn.error = result.status.error_source === 'paywall'
        ? 'The studio is out of credits. Ask the studio owner to add credits, then send your message again.'
        : 'That step didn’t work. Try describing the change again.';
    }).catch(error => {
      turn.error = error instanceof ApiError ? error.message : 'That step didn’t finish.';
      log.error(`turn failed for ${appId}: ${error.status || ''} ${error.code || error.message}`);
    }).finally(() => { turn.running = false; });
  }

  const routes = [
    ['GET', /^\/api\/health$/, async () => ({configured: base44.configured})],

    ['GET', /^\/api\/apps$/, async ({owner}) => ({apps: (await store.appsFor(owner)).map(({id, name, createdAt}) => ({id, name, createdAt}))})],

    ['POST', /^\/api\/apps$/, async ({owner, body}) => {
      const prompt = text(body.prompt, 12000), requestId = ID.test(body.requestId || '') ? body.requestId : null;
      if (!prompt) throw new ApiError(400, 'Describe the app you want to build.');
      if (!requestId) throw new ApiError(400, 'Missing request ID.');
      const key = `${owner}:${requestId}`;
      const existing = await store.appForRequest(key);
      if (existing) return summary(await store.update(existing, {}));
      if (!creating.has(key)) creating.set(key, queue.run(async () => {
        const app = await base44.createApp({prompt, customInstructions, requestId});
        await store.rememberRequest(key, app.id);
        return store.add(owner, {id: app.id, name: prompt.slice(0, 60), createdAt: new Date().toISOString()});
      }).finally(() => creating.delete(key)));
      return summary(await creating.get(key));
    }],

    ['GET', /^\/api\/apps\/([^/]+)$/, async ({appId}) => {
      const app = await base44.getApp(appId), turn = turns.get(appId);
      if (app.name && app.name !== 'untitled') await store.update(appId, {name: app.name});
      return {id: appId, name: app.name && app.name !== 'untitled' ? app.name : null,
        state: app.status?.state || 'processing', busy: Boolean(turn?.running), error: turn?.running ? null : turn?.error || null,
        outOfCredits: app.status?.state === 'error' && app.status?.error_source === 'paywall',
        published: Boolean(app.last_deployed_at && !app.is_unpublished)};
    }],

    ['GET', /^\/api\/apps\/([^/]+)\/messages$/, async ({appId, url}) => {
      const skip = Math.max(0, Number(url.searchParams.get('skip')) || 0);
      const {messages = []} = await base44.messages(appId, {limit: PAGE, skip}) || {};
      return {more: (messages || []).length === PAGE, messages: (messages || []).filter(m => !m.hidden && (m.role === 'user' || m.role === 'assistant')).map(m => ({
        id: m.id, role: m.role, content: m.content || '',
        questions: (m.tool_calls || []).filter(c => c.status === 'waiting_for_user_input').map(c => ({
          id: c.id, tool: c.name, kind: c.waiting_on?.kind || 'approval', args: parse(c.arguments_string), waitingOn: c.waiting_on || null}))
      })).filter(m => m.content.trim() || m.questions.length)};
    }],

    ['POST', /^\/api\/apps\/([^/]+)\/messages$/, async ({appId, body}) => {
      const content = text(body.content, 100000), requestId = ID.test(body.requestId || '') ? body.requestId : randomUUID();
      if (!content) throw new ApiError(400, 'Write a message first.');
      runTurn(appId, () => base44.sendMessage(appId, content, requestId));
      return {accepted: true};
    }],

    ['POST', /^\/api\/apps\/([^/]+)\/answers$/, async ({appId, body}) => {
      const toolCallId = ID.test(body.toolCallId || '') ? body.toolCallId : null;
      const action = body.action === 'approved' ? 'approved' : body.action === 'rejected' ? 'rejected' : null;
      if (!toolCallId || !action) throw new ApiError(400, 'Choose an answer first.');
      // Stable per answer, so a retried submit resumes the turn only once.
      runTurn(appId, () => base44.answer(appId, toolCallId, action, text(body.answer, 20000), `answer-${toolCallId}-${action}`));
      return {accepted: true};
    }],

    ['GET', /^\/api\/apps\/([^/]+)\/preview$/, async ({appId}) => {
      const preview = await base44.previewUrl(appId);
      const url = new URL(/^https?:\/\//.test(preview.preview_url) ? preview.preview_url : `https://${preview.preview_url}`);
      if (preview.preview_token) url.searchParams.set('_preview_token', preview.preview_token);
      return {url: url.href, coldStart: Boolean(preview.sandbox_info?.cold_start)};
    }],

    ['POST', /^\/api\/apps\/([^/]+)\/publish$/, async ({appId}) => {
      await base44.deploy(appId);
      return {url: (await base44.publishedUrl(appId)).url};
    }],

    ['GET', /^\/api\/apps\/([^/]+)\/published$/, async ({appId}) => {
      try { return {url: (await base44.publishedUrl(appId)).url}; }
      catch (error) { if (error.status === 404) return {url: null}; throw error; }
    }]
  ];

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    let owner = cookie(req, 'boo_visitor');
    if (!/^[a-f0-9]{48}$/.test(owner || '')) {
      owner = randomBytes(24).toString('hex');
      res.setHeader('Set-Cookie', `boo_visitor=${owner}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    }
    if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, req, res);
    try {
      if (req.method === 'POST' && !String(req.headers['content-type']).startsWith('application/json')) throw new ApiError(415, 'Expected JSON.');
      for (const [method, pattern, handler] of routes) {
        const match = url.pathname.match(pattern);
        if (!match || method !== req.method) continue;
        const appId = match[1] && decodeURIComponent(match[1]);
        if (appId !== undefined && (!ID.test(appId) || !(await store.owns(owner, appId)))) throw new ApiError(404, 'That app could not be found.');
        const body = req.method === 'POST' ? await readJson(req) : {};
        return send(res, 200, await handler({owner, appId, body, url}));
      }
      throw new ApiError(404, 'Not found.');
    } catch (error) {
      if (!(error instanceof ApiError)) log.error(error);
      else if (error.status >= 500 || error.status === 401 || error.status === 403) log.error(`${req.method} ${url.pathname}: ${error.status} ${error.code}`);
      send(res, error instanceof ApiError ? error.status : 500, {error: error instanceof ApiError ? error.message : 'Something went wrong.', code: error.code});
    }
  }

  async function serveStatic(path, req, res) {
    const file = STATIC[path];
    if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404); return res.end('Not found'); }
    try {
      const bytes = await readFile(resolve(root, file[0]));
      res.writeHead(200, {'Content-Type': file[1], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { res.writeHead(404); res.end('Not found'); }
  }

  return createServer((req, res) => { handle(req, res); });
}

function summary(app) { return {id: app.id, name: app.name, createdAt: app.createdAt}; }
function text(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function parse(value) { try { return value ? JSON.parse(value) : {}; } catch { return {}; } }
function cookie(req, name) { return String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '='))?.slice(name.length + 1); }
function send(res, status, data) { res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(data)); }
async function readJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 200_000) throw new ApiError(413, 'That message is too long.'); }
  try { const data = JSON.parse(raw || '{}'); return data && typeof data === 'object' ? data : {}; }
  catch { throw new ApiError(400, 'Invalid JSON.'); }
}
