export type Scope = { accountId: string; conversationId: string };
export type RejectedMessage = Scope & {
 messageId: string;
 createdAt: string;
 errorCode: string;
};
// Implement these operations against EXISTING MobileOutboxDb records. This is
// not a second message history or a plaintext draft store.
export interface RejectedOutboxPersistence {
 markPermanent(scope: Scope, messageId: string, code: string): Promise<void>;
 listPermanent(scope: Scope): Promise<RejectedMessage[]>;
 deletePermanent(scope: Scope, messageId: string): Promise<void>;
}
export function safeCode(code: unknown): string {
 return typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'RELAY_REJECTED';
}
export function rejectionReason(code: string): string {
 // Never display raw HTTP response bodies, ciphertext, identities or tokens.
 switch (code) {
  case 'CIPHERTEXT_TOO_LARGE': return 'The message exceeds the sending limit.';
  case 'CIPHERTEXT_REQUIRED': case 'CIPHERTEXT_EMPTY': case 'CIPHERTEXT_NOT_BASE64': case 'BODY_NOT_ALLOWED_FOR_KIND': return 'The encrypted message could not be accepted.';
  case 'CONVERSATION_NOT_FOUND': return 'This conversation is no longer available.';
  default: return 'The server refused this message.';
 }
}
export type RejectedOutbox = ReturnType<typeof createRejectedOutbox>;
export function createRejectedOutbox(db: RejectedOutboxPersistence, accountId: string) {
 if (!accountId) throw Error('ACCOUNT_REQUIRED');
 const listeners = new Set<() => void>();
 function publish() { for (const fn of listeners) { try { fn(); } catch { /* UI must not undo a committed DB write. */ } } }
 const scope = (conversationId: string): Scope => {
  if (!conversationId) throw Error('CONVERSATION_REQUIRED');
  return { accountId, conversationId };
 };
 return {
  async reject(conversationId: string, messageId: string, code: unknown) {
   // Resolve only AFTER atomic FAILED_PERMANENT+errorCode commit; never delete
   // the sealed bundle. If this fails, flush must stop and retain the queue row.
   await db.markPermanent(scope(conversationId), messageId, safeCode(code));
   publish();
  },
  async rejected(conversationId: string) {
   const s=scope(conversationId);const rows=await db.listPermanent(s);
   return rows.filter(r=>r.accountId===s.accountId&&r.conversationId===s.conversationId)
    .map(r=>({accountId:r.accountId,conversationId:r.conversationId,messageId:r.messageId,
     createdAt:r.createdAt,errorCode:safeCode(r.errorCode)}))
    .sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.messageId.localeCompare(b.messageId));
  },
  async discard(conversationId: string, messageId: string) {
   // Conditional deletion: FAILED_PERMANENT only. Never remove an in-flight
   // or transient message using this UI action.
   await db.deletePermanent(scope(conversationId), messageId);publish();
  },
  subscribe(listener: () => void) { listeners.add(listener);return()=>{listeners.delete(listener);}; }
 };
}
// Use ONLY codes the relay guarantees mean "not accepted".
// Unknown 4xx responses are not proof of permanent rejection; 401 needs session
// refresh, 409 may need key/conflict resolution, and 429 must wait.
export function isDefiniteRejection(status: number, code: unknown): boolean {
 const c=safeCode(code);
 // These are the codes server/src/chat/chat.service.ts sendMessage throws for a body it can never accept.
 return (status===422 && ['CIPHERTEXT_REQUIRED','CIPHERTEXT_EMPTY','CIPHERTEXT_NOT_BASE64','BODY_NOT_ALLOWED_FOR_KIND'].includes(c)) ||
  (status===413 && c==='CIPHERTEXT_TOO_LARGE') ||
  (status===404 && c==='CONVERSATION_NOT_FOUND');
}
export class PersistedRejection extends Error {
 messageId: string; code: string;
 constructor(messageId: string,code: string){super('MESSAGE_REJECTED');this.messageId=messageId;this.code=code;}
}
export async function postWithRetention<T extends {conversationId:string;messageId:string}>(input:{
 row:T; post:(row:T)=>Promise<void>; failures:Pick<RejectedOutbox,'reject'>;
 classify:(error:unknown)=>{permanent:boolean;code:string};
}){
 try{await input.post(input.row);}
 catch(error){
  if(error instanceof PersistedRejection)throw error;
  const result=input.classify(error);if(!result.permanent)throw error;
  const code=safeCode(result.code);
  await input.failures.reject(input.row.conversationId,input.row.messageId,code);
  throw new PersistedRejection(input.row.messageId,code);
 }
}
export async function flushRetained<T extends {conversationId: string; messageId: string}>(input: {
 rows: T[];
 post: (row: T) => Promise<void>;
 failures: Pick<RejectedOutbox,'reject'>;
 classify: (error: unknown) => {permanent: boolean; code: string};
 onRejected?: (messageId: string, code: string) => void;
}) {
 for (const row of input.rows) {
  try { await input.post(row); }
  catch(error) {
   const persisted=error instanceof PersistedRejection;
   const result=persisted?{permanent:true,code:error.code}:input.classify(error);
   if(!result.permanent) throw error;
   const code=safeCode(result.code);
   if(!persisted)await input.failures.reject(row.conversationId,row.messageId,code);
   // A notification exception must neither requeue nor discard committed data.
   try { input.onRejected?.(row.messageId,code); } catch { /* persistence is authoritative */ }
  }
 }
}
