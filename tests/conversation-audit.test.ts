import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConversationService} from '../clients/mobile/services/conversation.service';
test('a failed forward send reuses ciphertext even without a durable outbox',async()=>{
 let seals=0,online=false;const bodies:string[]=[];const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{bodies.push(String(init?.body));if(!online)throw Error('offline');return new Response(JSON.stringify({id:'accepted',createdAt:'2026-10-12T12:00:00Z'}));};
 const service=new ConversationService('https://test.local',async()=>'fixture','self',{seal:async()=>{seals++;return Buffer.from('opaque ciphertext '+seals).toString('base64');},open:async()=>''});
 try {await assert.rejects(service.send('chat',{type:'text',text:'forwarded',lane:'General',forwarded:true},'message'),/NETWORK/);online=true;await service.send('chat',{type:'text',text:'forwarded',lane:'General',forwarded:true},'message');assert.equal(seals,1);assert.equal(bodies[0],bodies[1]);} finally {globalThis.fetch=original;}
});
test('malformed visibility replies fail without declaring messages deleted',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async url=>new Response(JSON.stringify(String(url).endsWith('/visibility')?{}:{messages:[{id:'one',kind:'TEXT',ciphertext:'opaque',senderUserId:'peer',createdAt:'2026-10-12T12:00:00Z'}],nextCursor:null}));
 try {const service=new ConversationService('https://test.local',async()=>'fixture','self');await assert.rejects(service.loadHistory('chat','cursor'),/INVALID_MESSAGE_VISIBILITY/);}finally {globalThis.fetch=original;}
});
