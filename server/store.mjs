import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
// Single-process, durable owner/app mapping. Production requires a persistent disk.
export class Store {
  constructor(path) { this.path=path; this.data={apps:{},requests:{}}; this.writes=Promise.resolve(); }
  async init() {
    try { this.data=JSON.parse(await readFile(this.path,'utf8')); }
    catch(e) { if(e.code !== 'ENOENT') throw e; }
    // A crashed POST may already have succeeded upstream. Do not replay it automatically.
    for(const item of Object.values(this.data.requests)) if(item.state==='running') item.state='unknown';
    await this.save(); return this;
  }
  save() {
    const content=JSON.stringify(this.data);
    this.writes=this.writes.then(async()=>{await mkdir(dirname(this.path),{recursive:true,mode:0o700});await writeFile(this.path+'.tmp',content,{mode:0o600});await rename(this.path+'.tmp',this.path)});
    return this.writes;
  }
}
