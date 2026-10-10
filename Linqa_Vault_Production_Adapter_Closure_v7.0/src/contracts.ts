export type Principal={accountId:string;userId:string;deviceId:string;sessionId:string;scopes:string[]};
export type DeviceTrust={active:boolean;suspicious:boolean;attestation:'HARDWARE'|'BASIC'|'NONE';lastSeenAt?:string};
export interface PrincipalAdapter{require(req:unknown):Promise<Principal>}
export interface DeviceTrustAdapter{get(p:Principal):Promise<DeviceTrust>;list(accountId:string,userId:string):Promise<Array<Record<string,unknown>>>}
export interface TwoFactorAdapter{status(accountId:string,userId:string):Promise<{enabled:boolean;methods:string[]}>}
export interface LoginAlertAdapter{status(accountId:string,userId:string):Promise<{enabled:boolean;lastAlertAt?:string}>}
export interface SourceAttachment{sourceRef:string;size:number;sha256?:string;mime?:string;stream():AsyncIterable<Uint8Array>}
export interface AttachmentSourceAdapter{open(p:Principal,sourceRef:string):Promise<SourceAttachment>}
export interface BusinessSourceAdapter{openAuthorized(p:Principal,sourceRef:string):Promise<SourceAttachment>}
export interface ObjectStore{
 putStream(key:string,body:AsyncIterable<Uint8Array>,opts?:{contentType?:string}):Promise<void>;
 head(key:string):Promise<{size:number;sha256?:string;contentType?:string}>;
 signedGet(key:string,ttlSeconds:number):Promise<string>; delete(key:string):Promise<void>;
}
export interface MalwareScanner{scanObject(key:string):Promise<{verdict:'CLEAN'|'MALICIOUS'|'ERROR';engine:string;signature?:string}>}
export interface DlpScanner{scanObject(key:string):Promise<{verdict:'ALLOW'|'BLOCK'|'REVIEW'|'ERROR';labels:string[]}>}
export interface MailAdapter{sendSecureShare(input:{to:string;link:string;expiresAt:string}):Promise<{messageId:string}>}
export interface BillingAdapter{
 createCheckout(input:{accountId:string;userId:string;planCode:string;successUrl:string;cancelUrl:string}):Promise<{url:string;sessionId:string}>;
 verifyWebhook(raw:Buffer,headers:Record<string,string|undefined>):Promise<{eventId:string;type:string;payload:unknown}>;
}
export interface SocialExportAdapter{createCopy(input:{p:Principal;vaultObjectId:string;ciphertextDownloadUrl:string;metadata:Record<string,unknown>}):Promise<{socialAttachmentId:string}>}
export interface VaultCiphertextAdapter{
 assertOwned(p:Principal,objectId:string):Promise<{objectId:string;storageKey:string;classification:string;size:number}>;
 signedCiphertextGet(objectId:string,ttlSeconds:number):Promise<string>;
}
