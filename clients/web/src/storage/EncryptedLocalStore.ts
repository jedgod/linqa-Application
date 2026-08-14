export interface LocalMessage {
  id:string; conversationId:string; direction:"INCOMING"|"OUTGOING";
  ciphertext:Uint8Array; state:string; createdAt:string; updatedAt:string;
  recipientDeviceId?:string; expiresAt?:string;
}
export interface EncryptedLocalStore {
  putMessage(message:LocalMessage):Promise<void>;
  updateMessageState(messageId:string,state:string):Promise<void>;
  listPendingOutbox(limit:number):Promise<LocalMessage[]>;
  getMessage(messageId:string):Promise<LocalMessage|null>;
}
export class FailClosedEncryptedLocalStore implements EncryptedLocalStore {
  async putMessage():Promise<never>{throw new Error("Encrypted local store is not configured.");}
  async updateMessageState():Promise<never>{throw new Error("Encrypted local store is not configured.");}
  async listPendingOutbox():Promise<LocalMessage[]>{return[];}
  async getMessage():Promise<LocalMessage|null>{return null;}
}
