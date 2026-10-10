export type Purpose=
 'VAULT_UNLOCK'|'VAULT_PRIVATE_OPEN'|'VAULT_EXPORT_SOCIAL'|'VAULT_DELETE_PERMANENT'|'VAULT_SHARE_EXTERNAL'|
 'SEND_TRANSFER_AUTHORIZE'|'SEND_CASHOUT_AUTHORIZE'|'SEND_ADD_PAYMENT_METHOD'|'SEND_CHANGE_SECURITY';
export type Principal={userId:string;installationId:string;deviceId:string;sessionId:string;authTime:Date};
export interface DeviceTrustAdapter{get(p:Principal):Promise<{trusted:boolean;compromised:boolean;revoked:boolean;trustLevel:number}>}
export interface RiskAdapter{assess(x:{principal:Principal;purpose:Purpose;resource:unknown}):Promise<{allow:boolean;score:number;reason?:string}>}
export interface AttestationVerifier{
 verifyEnrollment(x:{platform:'IOS'|'ANDROID';publicKeySpki:Buffer;attestation:unknown;principal:Principal}):Promise<{verified:boolean;provider:string;keyId?:string;reason?:string;evidenceDigest?:Buffer}>;
}
export interface VaultPolicyAdapter{assertAllowed(x:{principal:Principal;purpose:Purpose;resource:unknown}):Promise<void>}
