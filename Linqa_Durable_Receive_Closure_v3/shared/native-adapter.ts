export type Scope = {accountId:string;deviceId:string;conversationId:string};
export type EnvelopeRow = {id:string;envelopeBase64:string};
export interface DurableNativeCore {
 capabilities(): Promise<{durableReceiveVersion:number}>;
 boundDeviceId(accountId:string): Promise<string>;
 readOrOpenAndCommit(scope:Scope,row:EnvelopeRow):Promise<string>;
 verifyKeyRevision(scope:Scope,event:unknown):Promise<string|null>;
 recordDisplayed(scope:Scope,messageIds:string[]):Promise<void>;
 pendingReceipts(scope:Scope,limit:number):Promise<string[]>;
 ackReceipts(scope:Scope,messageIds:string[]):Promise<void>;
 purgeAccount(accountId:string):Promise<void>;
}
export async function createDurableAdapter(core:DurableNativeCore,accountId:string,
 transport:{postRead(scope:Scope,ids:string[]):Promise<void>}) {
 if((await core.capabilities()).durableReceiveVersion!==1)throw new Error('DURABLE_RECEIVE_UNAVAILABLE');
 const deviceId=await core.boundDeviceId(accountId);
 if(!deviceId.trim())throw new Error('DEVICE_SCOPE_REQUIRED');
 const check=(s:Scope)=>{if(s.accountId!==accountId||s.deviceId!==deviceId||!s.conversationId.trim())throw new Error('DEVICE_SCOPE_MISMATCH');};
 return {deviceId,
  readOrOpenAndCommit:(s:Scope,r:EnvelopeRow)=>{check(s);return core.readOrOpenAndCommit(s,r);},
  verifyKeyRevision:(s:Scope,e:unknown)=>{check(s);return core.verifyKeyRevision(s,e);},
  recordDisplayed:(s:Scope,ids:string[])=>{check(s);return core.recordDisplayed(s,ids);},
  pendingReceipts:(s:Scope,n:number)=>{check(s);return core.pendingReceipts(s,n);},
  ackReceipts:(s:Scope,ids:string[])=>{check(s);return core.ackReceipts(s,ids);},
  sendReceipts:(s:Scope,ids:string[])=>{check(s);return transport.postRead(s,ids);}
 };
}
