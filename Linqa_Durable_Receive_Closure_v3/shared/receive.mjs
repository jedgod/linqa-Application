export function requireScope(scope){for(const k of ['accountId','deviceId','conversationId'])if(typeof scope[k]!=='string'||!scope[k].trim())throw new Error('DEVICE_SCOPE_REQUIRED');return Object.freeze({...scope});}
const transient=new Set(['SENDER_KEY_UNAVAILABLE','RECIPIENT_KEY_UNAVAILABLE']);
export class Receive {
 constructor(adapter,parse,changed=()=>{}){this.adapter=adapter;this.parse=parse;this.changed=changed;this.epoch=0;this.live=false;this.entries=new Map();this.flights=new Set();}
 enter(scope,live){this.scope=requireScope(scope);this.live=live;this.epoch++;this.entries.clear();this.flights.clear();this.changed();}
 invalidate(){this.live=false;this.epoch++;this.entries.clear();this.flights.clear();this.changed();}
 async open(row,{explicit=false,revision}={}){
  if(!this.live||this.flights.has(row.id))return;
  const old=this.entries.get(row.id);
  if(old?.state==='open'||old?.state==='blocked'||old?.state==='unavailable')return;
  if(old&&!explicit&&(!revision||old.revision===revision||old.attempts>=3))return;
  const epoch=this.epoch,scope=this.scope;this.flights.add(row.id);
  try{
   const text=await this.adapter.readOrOpenAndCommit(scope,row);
   if(!this.live||epoch!==this.epoch)return;
   const payload=this.parse(text);
   this.entries.set(row.id,payload?{state:'open',payload}:{state:'blocked',code:'INVALID_PAYLOAD'});
  }catch(error){
   if(!this.live||epoch!==this.epoch)return;
   const code=error?.code;
   this.entries.set(row.id,{state:transient.has(code)?'retryable':code==='REPLAY_WITHOUT_CACHE'?'unavailable':'blocked',code: typeof code==='string'?code:'OPEN_BLOCKED',attempts:(old?.attempts??0)+1,revision});
  }finally{if(this.live&&epoch===this.epoch){this.flights.delete(row.id);this.changed();}}
 }
 async verifiedKeys(event,rows){
  const epoch=this.epoch;
  // Native verifier resolves trust; a boolean supplied by the caller is insufficient.
  const revision=await this.adapter.verifyKeyRevision(this.scope,event);
  if(!this.live||epoch!==this.epoch||!revision)return;
  await Promise.all(rows.map(row=>this.open(row,{revision})));
 }
}
export class ReceiptQueue {
 constructor(adapter){this.adapter=adapter;this.busy=false;this.again=false;this.epoch=0;}
 reset(scope){this.scope=requireScope(scope);this.epoch++;this.busy=false;this.again=false;}
 async flush(){
  if(this.busy){this.again=true;return;}this.busy=true;
  const epoch=this.epoch,scope=this.scope;
  try{
   do{this.again=false;
    // Durable per-message receipt queue populated only for displayed open messages.
    const ids=await this.adapter.pendingReceipts(scope,100);
    if(epoch!==this.epoch||!ids.length)return;
    await this.adapter.sendReceipts(scope,ids);
    if(epoch!==this.epoch)return;
    await this.adapter.ackReceipts(scope,ids); // retry IDs unchanged if ack fails
    if(ids.length===100)this.again=true;
   }while(this.again&&epoch===this.epoch);
  }finally{if(epoch===this.epoch)this.busy=false;}
 }
}
