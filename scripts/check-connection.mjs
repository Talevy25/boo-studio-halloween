// Validates the server credentials with a List apps call and prints only the status code.
import {loadConfig} from '../server/config.mjs';
const {token, workspaceId, host} = loadConfig();
if (!token || !workspaceId) { console.log('Missing BASE44_ACCESS_TOKEN or BASE44_WORKSPACE_ID in .env.local'); process.exit(1); }
const url = new URL('/api/apps', host); url.searchParams.set('workspace_id', workspaceId); url.searchParams.set('limit', '1'); url.searchParams.set('fields', 'id');
const response = await fetch(url, {headers: {Authorization: `Bearer ${token}`, 'X-Active-Workspace-Id': workspaceId}, signal: AbortSignal.timeout(30000)});
const hint = {200: 'connected', 401: 'token or header is wrong', 403: 'token belongs to a different workspace or lacks a permission'}[response.status] || 'unexpected';
console.log(`List apps: ${response.status} (${hint})`);
process.exit(response.status === 200 ? 0 : 1);
