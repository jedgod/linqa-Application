import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatService,validateSend} from '../server/service.mjs';
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
