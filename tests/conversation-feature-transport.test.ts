import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConversationService, type SecureMessaging} from '../clients/mobile/services/conversation.service';
import type {SealedTextOutbox} from '../clients/mobile/services/sealed-text-outbox';
import {createRejectedOutbox} from '../clients/mobile/services/rejected-outbox';
import type {Payload} from '../clients/mobile/services/conversation-engine';
import {parseBody} from '../clients/mobile/services/conversation-engine';
import {buildTimeline,featureMessages} from '../clients/mobile/services/conversation-state';
const chat='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002',id='00000000-0000-4000-8000-000000000003';
test('feature sends retain only sealed bytes and retry after a service restart without resealing',async()=>{
  const rows=new Map<string,{messageId:string;conversationId:string;ciphertext:string}>();let seals=0;let offline=true;const posted:any[]=[];
  const failures=createRejectedOutbox({markPermanent:async()=>{},listPermanent:async()=>[],deletePermanent:async()=>{}},user);
  const outbox:SealedTextOutbox={failures,find:async id=>rows.get(id)?.ciphertext??null,put:async(messageId,conversationId,ciphertext)=>{rows.set(messageId,{messageId,conversationId,ciphertext});},remove:async id=>{rows.delete(id);},pending:async()=>[...rows.values()]};
  const secure:SecureMessaging={seal:async text=>{seals++;return Buffer.from('test-sealed-envelope:'+text).toString('base64');},open:async bytes=>Buffer.from(bytes,'base64').toString().slice(21)};
  const real=globalThis.fetch;globalThis.fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));posted.push(body);if(offline)throw Error('offline');return new Response(JSON.stringify({id,createdAt:'2026-10-09T10:00:00Z'}),{status:201});};
  try {
    const payload:Payload={type:'feature',content:{type:'poll',pollId:'poll',question:'Private question',options:[{id:'a',label:'Yes'},{id:'b',label:'No'}],multi:false,hideVoters:true}};
    const first=new ConversationService('https://api.test',async()=> 'token',user,secure,undefined,undefined,outbox);
    await assert.rejects(first.send(chat,payload,id),/NETWORK/);assert.equal(rows.size,1);assert.equal(JSON.stringify([...rows.values()]).includes('Private question'),false);
    offline=false;const restarted=new ConversationService('https://api.test',async()=> 'token',user,secure,undefined,undefined,outbox);
    await restarted.send(chat,payload,id);assert.equal(seals,1);assert.equal(rows.size,0);assert.deepEqual(posted[0],posted[1]);
    assert.deepEqual(Object.keys(posted[0]).sort(),['ciphertext','clientMessageId','kind']);
  } finally {globalThis.fetch=real;}
});
test('malformed feature messages cannot enter the send path or become raw text',async()=>{
  const service=new ConversationService('https://api.test',async()=>{throw Error('should not request token');},user);
  const payload={type:'feature',content:{type:'location',latitude:999,longitude:0}};
  await assert.rejects(service.send(chat,payload as Payload,id),/Invalid feature/);assert.equal(parseBody(JSON.stringify(payload)),null);
});
test('failed votes remain retryable but do not affect poll totals until accepted',()=>{
  const vote={id,senderId:user,sentAt:'2026-10-09T10:00:00Z',outgoing:true,delivery:'failed' as const,body:{state:'open' as const,payload:{type:'feature' as const,content:{type:'poll_vote' as const,pollId:'p',optionIds:['a']}}}};
  assert.equal(featureMessages([vote]).length,0);assert.equal(buildTimeline([vote],'All')[0]?.kind,'feature');
  const sent={...vote,delivery:'sent' as const};assert.equal(featureMessages([sent]).length,1);assert.equal(buildTimeline([sent],'All').length,0);
});
