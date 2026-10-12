// Apps API, verified against https://docs.base44.com/developers/white-label/the-build-turn
export class ApiError extends Error {
  constructor(status, message, code = 'request_failed') { super(message); this.status = status; this.code = code; }
}
export class Base44 {
  constructor({token, workspaceId, fetchImpl = fetch, timeout = 120000, publicSettings}) {
    this.token = token; this.workspaceId = workspaceId; this.fetch = fetchImpl; this.timeout = timeout; this.publicSettings = publicSettings;
  }
  async request(path, {method = 'GET', body, requestId} = {}) {
    if (!this.token || !this.workspaceId) throw new ApiError(503, 'The builder has not been configured on the server.', 'not_configured');
    let response;
    try {
      response = await this.fetch(`https://app.base44.com/api${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(this.timeout),
        headers: {Authorization: `Bearer ${this.token}`, 'X-Active-Workspace-Id': this.workspaceId,
          'Content-Type': 'application/json', ...(requestId ? {'X-Request-ID': requestId} : {})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)})
      });
    } catch {
      throw new ApiError(502, 'Base44 did not confirm the result. Check the app status before trying another build.', 'result_unknown');
    }
    if (!response.ok) {
      // Never echo upstream bodies: they can include credentials, file contents, or internal details.
      const message = response.status === 401 || response.status === 403 ? 'Base44 denied access. Check the server token and workspace permissions.'
        : response.status === 429 ? 'Base44 is busy. Please wait before starting another build.'
        : response.status === 404 ? 'Base44 could not find that resource.' : 'Base44 could not complete this request.';
      throw new ApiError(response.status >= 500 ? 502 : response.status, message, response.status >= 500 ? 'result_unknown' : 'upstream_rejected');
    }
    try { return await response.json(); }
    catch { throw new ApiError(502, 'Base44 returned an unexpected response.', 'result_unknown'); }
  }
  create(prompt, name, requestId) {
    return this.request('/apps', {method:'POST', requestId, body: {
      name, initial_message:{content:prompt}, organization_id:this.workspaceId,
      ...(this.publicSettings ? {public_settings:this.publicSettings} : {}), prevent_iframe_embedding:true,
      custom_instructions:'Create a polished, responsive app. Use a tasteful Halloween visual theme with warm pumpkin accents, dark backgrounds, accessible contrast, and reduced-motion support. Follow the user’s functional requirements. The user interacts through Boo Studio chat and preview, with a Publish button. Never direct them to a Base44 editor or dashboard. Ask for clarification using structured questions when needed. Never include platform credentials in generated code.'
    }});
  }
  get(id) { return this.request(`/apps/${encodeURIComponent(id)}`); }
  messages(id, skip=0) { return this.request(`/apps/${encodeURIComponent(id)}/chat/full-conversation?limit=20&skip=${skip}`); }
  chat(id, content, requestId) { return this.request(`/apps/${encodeURIComponent(id)}/chat/message`, {method:'POST',body:{content},requestId}); }
  answer(id, body, requestId) { return this.request(`/apps/${encodeURIComponent(id)}/chat/submit-tool-call-input`, {method:'POST',body,requestId}); }
  preview(id) { return this.request(`/apps/${encodeURIComponent(id)}/sandbox/preview-url`); }
  deploy(id, requestId) { return this.request(`/apps/${encodeURIComponent(id)}/deploy`, {method:'POST',body:{},requestId}); }
  published(id) { return this.request(`/apps/platform/${encodeURIComponent(id)}/published-url`); }
}
export function safeApp(app) {
  return {id:app.id, name:app.name || 'Untitled creation', public_settings:app.public_settings,
    status:{state:app.status?.state || 'unknown', details:app.status?.details || ''}};
}
export function safeMessages(data) {
  return (data.messages || []).map(m=>({
    id:m.id, role:m.role, content:m.hidden ? '' : typeof m.content === 'string' ? m.content : '', hidden:!!m.hidden,
    tool_calls:(m.tool_calls || []).filter(t=>t.status === 'waiting_for_user_input').map(t=>({
      id:t.id, message_id:m.id, name:t.name, status:t.status, arguments:t.arguments, approval:t.approval, arguments_string:t.arguments_string || '', waiting_on:t.waiting_on || {kind:'unsupported'}
    }))
  }));
}
export function previewURL(data) {
  const url = new URL(data.preview_url.includes('://') ? data.preview_url : `https://${data.preview_url}`);
  if (url.protocol !== 'https:' || url.username || url.password) throw new ApiError(502,'Base44 returned an invalid preview address.');
  if (data.preview_token) url.searchParams.set('_preview_token', data.preview_token);
  return url.href;
}
