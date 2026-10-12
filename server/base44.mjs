// Apps API client. Every call authenticates as the integration account; the token never leaves the server.
// See https://docs.base44.com/developers/white-label/the-build-turn
export class ApiError extends Error {
  constructor(status, message, code = 'request_failed') { super(message); this.status = status; this.code = code; }
}

const LONG = 120_000; // Build turns run from ~30s to several minutes.
const TURN = 15 * 60_000; // Send and submit hold the request open until the whole turn settles.

export class Base44 {
  constructor({token, workspaceId, host = 'https://app.base44.com', fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms))}) {
    Object.assign(this, {token, workspaceId, host, fetch: fetchImpl, sleep});
  }
  get configured() { return Boolean(this.token && this.workspaceId); }

  async request(path, {method = 'GET', body, requestId, timeout = 30_000, query} = {}) {
    if (!this.configured) throw new ApiError(503, 'The builder is not connected yet.', 'not_configured');
    const url = new URL(`/api${path}`, this.host);
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined) url.searchParams.set(key, value);
    let response;
    try {
      response = await this.fetch(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(timeout),
        headers: {
          Authorization: `Bearer ${this.token}`, 'X-Active-Workspace-Id': this.workspaceId,
          ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
          ...(requestId ? {'X-Request-ID': requestId} : {})
        },
        ...(body === undefined ? {} : {body: JSON.stringify(body)})
      });
    } catch {
      throw new ApiError(502, 'The builder did not confirm the result.', 'result_unknown');
    }
    if (!response.ok) {
      // Upstream bodies can carry file contents or internal details, so only a short code is surfaced.
      let code = '';
      try { const data = await response.json(); code = data?.error?.code || data?.detail?.code || ''; } catch {}
      throw new ApiError(response.status, describe(response.status, code), code || 'upstream_rejected');
    }
    return response.status === 204 ? null : response.json();
  }

  // Send and submit are safe to retry with the same X-Request-ID; the server dedupes them.
  async retryable(path, body, requestId) {
    for (let attempt = 0; ; attempt++) {
      try { return await this.request(path, {method: 'POST', body, requestId, timeout: TURN}); }
      catch (error) {
        const transient = error.status === 503 || error.code === 'result_unknown';
        if (!transient || attempt >= 2) throw error;
        await this.sleep(2000 * (attempt + 1));
      }
    }
  }

  listApps() { return this.request('/apps', {query: {workspace_id: this.workspaceId, limit: 1, fields: 'id'}}); }
  createApp({prompt, customInstructions, requestId}) {
    return this.request('/apps', {method: 'POST', timeout: LONG, requestId, body: {
      initial_message: {content: prompt},
      organization_id: this.workspaceId,
      custom_instructions: customInstructions,
      public_settings: 'public_without_login'
    }});
  }
  getApp(appId) { return this.request(`/apps/${enc(appId)}`); }
  messages(appId, {limit, skip} = {}) { return this.request(`/apps/${enc(appId)}/chat/full-conversation`, {query: {limit, skip}, timeout: LONG}); }
  sendMessage(appId, content, requestId) { return this.retryable(`/apps/${enc(appId)}/chat/message`, {content}, requestId); }
  answer(appId, toolCallId, action, extra, requestId) {
    return this.retryable(`/apps/${enc(appId)}/chat/submit-tool-call-input`,
      {tool_call_id: toolCallId, action, ...(extra ? {extra_user_input: extra} : {})}, requestId);
  }
  previewUrl(appId) { return this.request(`/apps/${enc(appId)}/sandbox/preview-url`, {timeout: LONG}); }
  deploy(appId) { return this.request(`/apps/${enc(appId)}/deploy`, {method: 'POST', body: {}, timeout: LONG}); }
  publishedUrl(appId) { return this.request(`/apps/platform/${enc(appId)}/published-url`); }
}

const enc = encodeURIComponent;
function describe(status, code) {
  if (status === 401) return 'The builder’s server credentials were rejected.';
  if (status === 403) return code === 'read_only_credential_route_not_allowed' ? 'The server token is read-only; it needs Full access.' : 'The builder does not have access to that.';
  if (status === 404) return 'That could not be found.';
  if (status === 409) return 'The app is busy right now. Try again when it finishes.';
  if (status === 429) return 'Lots of spooky ideas at once. Please wait a moment.';
  return 'The builder could not complete this request.';
}
