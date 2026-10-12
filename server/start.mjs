import {Base44} from './base44.mjs';
import {createApp} from './app.mjs';
import {loadConfig} from './config.mjs';
import {CreateQueue} from './queue.mjs';
import {Store} from './store.mjs';

const config = loadConfig();
const base44 = new Base44(config);
const server = createApp({base44, store: new Store(config.dataDir), queue: new CreateQueue(), root: process.argv[2] || '.'});
const port = Number(process.env.PORT || 5173), host = process.env.HOST || '127.0.0.1';
// Long build turns hold requests open; keep Node from cutting them off.
server.requestTimeout = 0; server.headersTimeout = 130_000;
server.listen(port, host, () => {
  console.log(`Boo Studio ready at http://${host}:${port}`);
  if (!base44.configured) console.log('Builder not connected: add BASE44_ACCESS_TOKEN and BASE44_WORKSPACE_ID to .env.local');
});
