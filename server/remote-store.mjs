// Single-instance store. Base44 persists records independently of the Render disk.
export class RemoteStore {
  constructor(client,appId,recordId){
    if(!/^[a-f\d]{24}$/.test(appId)||!/^[a-f\d]{24}$/.test(recordId))throw Error('Invalid state record configuration.');
    this.client=client;this.path=`/apps/${appId}/entities/StudioState/${recordId}`;this.writes=Promise.resolve();
  }
  async init(){
    const record=await this.client.request(this.path);
    this.data=JSON.parse(record.payload);
    if(!this.data.apps||!this.data.requests)throw Error('Invalid persisted studio data.');
    for(const item of Object.values(this.data.requests))if(item.state==='running')item.state='unknown';
    await this.save();return this;
  }
  save(){
    const payload=JSON.stringify(this.data);
    const write=this.writes.then(()=>this.client.request(this.path,{method:'PUT',body:{payload}}));
    // Preserve failure for this caller, while permitting later writes to recover.
    this.writes=write.catch(()=>{});return write;
  }
}
