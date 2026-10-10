import {randomUUID, createHash} from 'node:crypto';
export class ChatError extends Error {
 constructor(status, message) { super(message); this.status = status; }
}
export const requireValue = (ok, status, message) => { if (!ok) throw new ChatError(status, message); };
export const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validateSend(input) {
 requireValue(input && isUuid(input.clientId),400,'Invalid clientId');
 requireValue(Array.isArray(input.envelopes) && input.envelopes.length > 0 && input.envelopes.length <= 32,400,'Invalid envelopes');
 const seen = new Set(); let total = 0;
 for (const e of input.envelopes) {
  requireValue(isUuid(e.userId) && typeof e.deviceId === 'string' && e.deviceId.length > 0 && e.deviceId.length <= 128,400,'Invalid device');
  requireValue(typeof e.ciphertext === 'string' && e.ciphertext.length >= 16 && e.ciphertext.length <= 131072 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(e.ciphertext),400,'Invalid ciphertext');
  const k = JSON.stringify([e.userId,e.deviceId]); requireValue(!seen.has(k),400,'Duplicate device'); seen.add(k); total += e.ciphertext.length;
 }
 requireValue(total <= 1048576,413,'Envelope batch too large');
 return input;
}
export function createChatService({repo, policy, devices}) {
 // policy must consult canonical accounts, blocks, chat requests and discovery.
 async function authorize(actor, id) {
  requireValue(isUuid(id),400,'Invalid conversation');
  const members = await repo.members(id);
  requireValue(members.includes(actor.userId),404,'Conversation unavailable');
  const other = members.find(x => x !== actor.userId);
  requireValue(other && await policy.canChat(actor.userId,other),403,'Chat is not permitted');
  return members;
 }
 return {
  async open(actor, peerId) {
   requireValue(isUuid(peerId) && peerId !== actor.userId,400,'Invalid recipient');
   requireValue(await policy.canChat(actor.userId,peerId),403,'Chat is not permitted');
   const pair = [actor.userId,peerId].sort();
   return repo.open(createHash('sha256').update(pair.join(':')).digest('hex'),pair);
  },
  async list(actor) { return repo.list(actor.userId); },
  async history(actor,id,after='0') {
   await authorize(actor,id);
   requireValue(typeof after === 'string' && /^\d{1,20}$/.test(after) && BigInt(after) <= 9223372036854775807n,400,'Invalid cursor');
   return repo.history(id,actor,after);
  },
  async send(actor,id,input) {
   const members = await authorize(actor,id); validateSend(input);
   const eligible = await devices.listForUsers(members);
   requireValue(eligible.every(e=>members.includes(e.userId)) && members.every(u=>eligible.some(e=>e.userId===u)),409,'Recipient device unavailable');
   const wanted = new Set(eligible.map(x=>JSON.stringify([x.userId,x.deviceId])));
   requireValue(wanted.size > 0 && wanted.has(JSON.stringify([actor.userId,actor.deviceId])),409,'Device not active');
   requireValue(input.envelopes.length === wanted.size && input.envelopes.every(e=>wanted.has(JSON.stringify([e.userId,e.deviceId]))),409,'Device set changed; refresh keys and retry');
   // Caller encryption must authenticate conversation ID, sender and client ID as AAD.
   return repo.append(id,actor,input,randomUUID());
  }
 };
}
