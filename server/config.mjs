import {readFileSync} from 'node:fs';

// Reads .env.local without printing it. Real environment variables win, so hosting providers can override.
export function loadConfig(file = '.env.local') {
  const values = {};
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {}
  const get = name => process.env[name] || values[name] || '';
  return {
    token: get('BASE44_ACCESS_TOKEN'),
    workspaceId: get('BASE44_WORKSPACE_ID'),
    host: (get('BASE44_PLATFORM_HOST') || 'https://app.base44.com').replace(/\/+$/, ''),
    dataDir: get('BOO_DATA_DIR') || 'data'
  };
}
