import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Who built which app. Base44 sees one integration account behind every build,
// so ownership lives here and is checked before every app-specific call.
export class Store {
  constructor(dir) { this.file = join(dir, 'apps.json'); this.dir = dir; this.data = null; this.writing = Promise.resolve(); }
  async load() {
    if (this.data) return this.data;
    try { this.data = JSON.parse(await readFile(this.file, 'utf8')); } catch { this.data = {apps: {}, requests: {}}; }
    this.data.requests ||= {};
    return this.data;
  }
  async save() {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writing = this.writing.then(async () => {
      await mkdir(this.dir, {recursive: true});
      await writeFile(this.file + '.tmp', snapshot);
      await rename(this.file + '.tmp', this.file);
    });
    return this.writing;
  }
  async appsFor(owner) {
    const {apps} = await this.load();
    return Object.values(apps).filter(app => app.owner === owner).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async owns(owner, appId) { const {apps} = await this.load(); return apps[appId]?.owner === owner; }
  async add(owner, app) { const data = await this.load(); data.apps[app.id] = {...app, owner}; await this.save(); return data.apps[app.id]; }
  async update(appId, fields) { const data = await this.load(); if (data.apps[appId]) { Object.assign(data.apps[appId], fields); await this.save(); } return data.apps[appId]; }
  // Remembers which app a create request produced, so a retried submit returns it instead of building twice.
  async appForRequest(requestId) { const {requests} = await this.load(); return requests[requestId]; }
  async rememberRequest(requestId, appId) { const data = await this.load(); data.requests[requestId] = appId; await this.save(); }
}
