import crypto from 'node:crypto';
export type SendAuthorizationResource={
  transferId:string; transferVersion:number; action:'AUTHORIZE_TRANSFER'|'AUTHORIZE_CASHOUT';
  amountMinor:string; currency:string; feeMinor:string; recipientId:string; recipientFingerprint:string;
  quoteId:string; quoteVersion:number; rail:string; sourceWalletId:string;
};
export function canonicalSendResource(r:SendAuthorizationResource){
  return JSON.stringify({
    action:r.action,amountMinor:r.amountMinor,currency:r.currency,feeMinor:r.feeMinor,
    quoteId:r.quoteId,quoteVersion:r.quoteVersion,rail:r.rail,recipientFingerprint:r.recipientFingerprint,
    recipientId:r.recipientId,sourceWalletId:r.sourceWalletId,transferId:r.transferId,transferVersion:r.transferVersion
  });
}
export function sendResourceHash(r:SendAuthorizationResource){
  return crypto.createHash('sha256').update(canonicalSendResource(r),'utf8').digest();
}
export interface TransferAdapter{
  loadAuthorizationResourceForUpdate(client:unknown,transferId:string,userId:string):Promise<SendAuthorizationResource>;
}
