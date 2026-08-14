import type { EncryptedLocalStore } from "../storage/EncryptedLocalStore";
export class OutboxWorker {
  private running=false;
  constructor(private readonly store:EncryptedLocalStore,private readonly retry:(messageId:string)=>Promise<void>){}
  async runOnce(){if(this.running)return;this.running=true;try{for(const m of await this.store.listPendingOutbox(50)){try{await this.retry(m.id);}catch{}}}finally{this.running=false;}}
}
