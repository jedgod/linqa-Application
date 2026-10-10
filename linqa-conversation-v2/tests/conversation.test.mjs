import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatService,validateSend} from '../server/service.mjs';
import {projectEvents,validatePayload,createConversationClient} from '../shared/engine.mjs';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',id='00000000-0000-4000-8000-000000000003',clientId='00000000-0000-4000-8000-000000000004';
const actor={userId:a,deviceId:'A'};const ciphertext=Buffer.alloc(32).toString('base64');
const envelopes=[{userId:a,deviceId:'A',ciphertext},{userId:b,deviceId:'B',ciphertext}];
function service({members=[a,b],allowed=true,eligible=envelopes}={}){
 return createChatService({repo:{members:async()=>members,append:async()=>({id}),open:async()=>({id})},policy:{canChat:async()=>allowed},devices:{listForUsers:async()=>eligible}});
}
test('nonmember cannot read history',async()=>{await assert.rejects(service({members:[b]}).history(actor,id),/unavailable/);});
test('block policy rejects sends and conversation initiation',async()=>{const s=service({allowed:false});await assert.rejects(s.send(actor,id,{clientId,envelopes}),/not permitted/);await assert.rejects(s.open(actor,b),/not permitted/);});
test('self chat rejected',async()=>{await assert.rejects(service().open(actor,a),/recipient/);});
test('duplicate envelope rejected',()=>assert.throws(()=>validateSend({clientId,envelopes:[envelopes[0],envelopes[0]]}),/Duplicate/));
test('missing recipient envelope fails closed',async()=>{await assert.rejects(service().send(actor,id,{clientId,envelopes:[envelopes[0]]}),/Device set changed/);});
test('unauthorized target device rejected',async()=>{await assert.rejects(service().send(actor,id,{clientId,envelopes:[envelopes[0],{...envelopes[1],deviceId:'C'}]}),/Device set changed/);});
test('valid encrypted device batch accepted',async()=>assert.equal((await service().send(actor,id,{clientId,envelopes})).id,id));
test('invalid cursor rejected',async()=>{await assert.rejects(service().history(actor,id,'-1'),/cursor/);});
test('plaintext field is not accepted as ciphertext',()=>assert.throws(()=>validateSend({clientId,envelopes:[{...envelopes[0],ciphertext:'hello world!'}]}),/ciphertext/));
test('one vote per sender, latest choice wins, out-of-range ignored',()=>{
 const e=(seq,sender_id,payload)=>({seq:String(seq),sender_id,client_id:seq===1?clientId:`vote${seq}`,payload});
 const result=projectEvents([e(1,a,{type:'decision',title:'When?',options:['3 PM','4 PM']}),e(2,a,{type:'vote',boardId:clientId,choice:0}),e(3,a,{type:'vote',boardId:clientId,choice:1}),e(4,b,{type:'vote',boardId:clientId,choice:0}),e(5,b,{type:'vote',boardId:clientId,choice:4})]);
 assert.deepEqual(result[0].votes,{[a]:1,[b]:0});
});
test('invalid payloads rejected',()=>{assert.throws(()=>validatePayload({type:'text',text:'',lane:'General'}));assert.throws(()=>validatePayload({type:'decision',title:'x',options:['same','same']}));});
test('send uses crypto envelopes and stable retry client ID',async()=>{
 const calls=[];const client=createConversationClient({actor,uuid:()=>clientId,crypto:{encryptForDevices:async()=>envelopes,decryptAuthenticated:async()=>({type:'text',text:'ok',lane:'General'})},request:async(path,options)=>{calls.push(options.body);return{id};}});
 const d=client.draft({type:'text',text:'secret text',lane:'Plans'});await client.send(id,d);await client.send(id,d);
 assert.equal(calls[0].clientId,calls[1].clientId);assert.equal(JSON.stringify(calls).includes('secret text'),false);
});
test('failed authenticated decryption never yields displayable plaintext',async()=>{
 const client=createConversationClient({actor,uuid:()=>clientId,crypto:{encryptForDevices:async()=>envelopes,decryptAuthenticated:async()=>{throw Error('Signature invalid');}},request:async()=>({events:[{ciphertext,sender_id:b,client_id:clientId}],cursor:'1'})});
 await assert.rejects(client.page(id,'0'),/Signature invalid/);
});
