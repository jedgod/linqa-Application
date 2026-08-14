export interface SecureCoreBridge {
  runtimeInfo():Promise<{secureCoreReady:boolean;apiVersion:number;protocolVersion:number;buildVersion:string}>;
  createEnrollmentProof(input:{userId:string;deviceId:string;challengeBase64:string;deviceName?:string;platform?:"WEB"|"DESKTOP"}):Promise<Uint8Array>;
  createKeyPackage():Promise<Uint8Array>;
  encryptMessage(input:{messageId:string;senderUserId:string;senderDeviceId:string;recipientUserId:string;recipientDeviceId:string;recipientKeyPackageBase64:string;plaintext:string;createdAtUnix:number;expiresAtUnix:number}):Promise<Uint8Array>;
  decryptMessage(ciphertext:Uint8Array,senderSigningPublicKeyBase64?:string):Promise<{messageId:string;senderUserId:string;senderDeviceId:string;plaintext:string}>;
}

export class FailClosedCoreBridge implements SecureCoreBridge {
  async runtimeInfo(){return{secureCoreReady:false,apiVersion:0,protocolVersion:0,buildVersion:"unavailable"};}
  async createEnrollmentProof():Promise<never>{throw new Error("Secure core is not configured.");}
  async createKeyPackage():Promise<never>{throw new Error("Secure core is not configured.");}
  async encryptMessage():Promise<never>{throw new Error("Secure core is not configured.");}
  async decryptMessage():Promise<never>{throw new Error("Secure core is not configured.");}
}
