import type { SecureCoreBridge } from "../core/SecureCoreBridge";
import type { EncryptedLocalStore } from "../storage/EncryptedLocalStore";
import { verifyTransparencyProof, type TransparencyInclusionProof } from "../security/TransparencyVerifier";

export interface MessagingApi {
  keyPackages(userId:string):Promise<{keyPackages:Array<{deviceId:string;packageBase64:string;expiresAt:string;transparencyProof?:TransparencyInclusionProof}>}>;
  sendEnvelope(input:{recipientDeviceId:string;clientMessageId:string;ciphertext:Uint8Array;expiresAt:string}):Promise<{envelopeId:string;serverSequence:number}>;
  receive():Promise<{leaseOwner:string;envelopes:Array<{id:string;ciphertextBase64:string;senderSigningPublicKeyBase64:string}>}>;
  acknowledge(leaseOwner:string,envelopeIds:string[]):Promise<unknown>;
}

export class ProductionMessagingCoordinator {
  constructor(
    private readonly core:SecureCoreBridge,
    private readonly store:EncryptedLocalStore,
    private readonly api:MessagingApi,
    private readonly identity:{userId:string;deviceId:string},
    private readonly onReceived?: (message: {messageId:string;senderUserId:string;senderDeviceId:string;plaintext:string}) => void
  ){}

  async send(input:{conversationId:string;recipientUserId:string;plaintext:string;clientMessageId?:string}) {
    const runtime=await this.core.runtimeInfo();
    if(!runtime.secureCoreReady)throw new Error("Secure core unavailable.");
    const packages=await this.api.keyPackages(input.recipientUserId);
    const recipient=packages.keyPackages.find(k=>new Date(k.expiresAt).getTime()>Date.now());
    if(!recipient)throw new Error("No valid recipient key package.");
    const checkpointKey=import.meta.env.VITE_TRANSPARENCY_PUBLIC_KEY_BASE64;
    if(!recipient.transparencyProof || typeof checkpointKey !== "string" || !checkpointKey)throw new Error("Transparency proof is unavailable.");
    const packageBytes=Uint8Array.from(atob(recipient.packageBase64),c=>c.charCodeAt(0));
    await verifyTransparencyProof({packageBytes,proof:recipient.transparencyProof,checkpointPublicKeyBase64:checkpointKey});
    const messageId=input.clientMessageId ?? crypto.randomUUID();
    const createdAtUnix=Math.floor(Date.now()/1000),expiresAtUnix=createdAtUnix+2592000;
    const ciphertext=await this.core.encryptMessage({messageId,senderUserId:this.identity.userId,senderDeviceId:this.identity.deviceId,recipientUserId:input.recipientUserId,recipientDeviceId:recipient.deviceId,recipientKeyPackageBase64:recipient.packageBase64,plaintext:input.plaintext,createdAtUnix,expiresAtUnix});
    const expiresAt = new Date(expiresAtUnix*1000).toISOString();
    await this.store.putMessage({id:messageId,conversationId:input.conversationId,direction:"OUTGOING",ciphertext,state:"QUEUED",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),recipientDeviceId:recipient.deviceId,expiresAt});
    try {
      await this.store.updateMessageState(messageId,"UPLOADING");
      const accepted=await this.api.sendEnvelope({recipientDeviceId:recipient.deviceId,clientMessageId:messageId,ciphertext,expiresAt});
      await this.store.updateMessageState(messageId,"ACCEPTED_BY_RELAY");
      return{messageId,...accepted};
    } catch(error) {
      await this.store.updateMessageState(messageId,"FAILED_RETRYABLE");
      throw error;
    }
  }

  async retry(messageId:string) {
    const pending=await this.store.getMessage(messageId);
    if(!pending || pending.direction!=="OUTGOING" || !pending.recipientDeviceId || !pending.expiresAt) {
      throw new Error("Retryable encrypted envelope metadata is unavailable.");
    }
    if(new Date(pending.expiresAt).getTime()<=Date.now()) {
      await this.store.updateMessageState(messageId,"FAILED_PERMANENT");
      return;
    }
    await this.store.updateMessageState(messageId,"UPLOADING");
    try {
      await this.api.sendEnvelope({recipientDeviceId:pending.recipientDeviceId,clientMessageId:messageId,ciphertext:pending.ciphertext,expiresAt:pending.expiresAt});
      await this.store.updateMessageState(messageId,"ACCEPTED_BY_RELAY");
    } catch(error) {
      await this.store.updateMessageState(messageId,"FAILED_RETRYABLE");
      throw error;
    }
  }

  async receive() {
    const batch=await this.api.receive();
    const acknowledged:string[]=[],messages=[];
    for(const envelope of batch.envelopes) {
      try {
        const bytes=Uint8Array.from(atob(envelope.ciphertextBase64),c=>c.charCodeAt(0));
        const header=JSON.parse(new TextDecoder().decode(bytes)) as {header?:{message_id?:string}};
        const claimedMessageId=header.header?.message_id;
        if(!claimedMessageId)throw new Error("Encrypted envelope message ID is missing.");
        if(await this.store.getMessage(`incoming:${claimedMessageId}`)) {
          acknowledged.push(envelope.id);
          continue;
        }
        const message=await this.core.decryptMessage(bytes,envelope.senderSigningPublicKeyBase64);
        if(message.messageId!==claimedMessageId)throw new Error("Encrypted envelope message ID mismatch.");
        await this.store.putMessage({id:`incoming:${message.messageId}`,conversationId:"resolved-from-envelope",direction:"INCOMING",ciphertext:bytes,state:"DELIVERED",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
        messages.push(message);this.onReceived?.(message);acknowledged.push(envelope.id);
      } catch { /* never acknowledge cryptographic failure */ }
    }
    if(acknowledged.length)await this.api.acknowledge(batch.leaseOwner,acknowledged);
    return messages;
  }
}
