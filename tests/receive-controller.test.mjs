import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReceiveController } from '../clients/mobile/services/receive-controller.ts';
const scope = { accountId: 'a', deviceId: 'd', conversationId: 'c' };
const row = { id: '1', senderId: 'b' };
function make(open, markRead = async()=>{}) {
 const c = new ReceiveController({readOrOpenAndCommit:open, classify:e=>e.kind, safeCode:()=> 'OPEN_FAILED', markRead}, JSON.parse);
 c.enter(scope,true); return c;
}
test('committed payload opens',async()=>{const c=make(async()=>'{"type":"text","text":"hello"}');await c.open(row);assert.equal(c.body('1').state,'open');});
test('deletion drops a body and prevents a late decrypt from restoring it',async()=>{let resolve;let calls=0;const c=make(()=>{calls++;return new Promise(r=>resolve=r);});const opening=c.open(row);c.forget(row.id);resolve('{"type":"text","text":"deleted"}');await opening;await c.open(row);c.seed(row.id,{type:'text',text:'deleted'});assert.equal(c.bodies.size,0);assert.equal(c.failed(row.id),false);assert.equal(calls,1);});
test('lock and unlock invalidates old decrypt',async()=>{let resolve;const c=make(()=>new Promise(r=>resolve=r));const p=c.open(row);c.enter(scope,false);c.enter(scope,true);resolve('{}');await p;assert.equal(c.bodies.size,0);});
test('account switch invalidates old decrypt',async()=>{let resolve;const c=make(()=>new Promise(r=>resolve=r));const p=c.open(row);c.enter({...scope,accountId:'other'},true);resolve('{}');await p;assert.equal(c.bodies.size,0);});
test('tampering remains blocked even with explicit retry',async()=>{let n=0;const c=make(async()=>{n++;throw {kind:'authentication'};});await c.open(row);await c.open(row,{explicit:true});assert.equal(n,1);});
test('transient failure has explicit retry',async()=>{let n=0;const c=make(async()=>{if(++n===1)throw {kind:'transient'};return '{}';});await c.open(row);await c.open(row);assert.equal(n,1);await c.open(row,{explicit:true});assert.equal(c.body('1').state,'open');});
test('key revisions bound automatic retries',async()=>{let n=0;const c=make(async()=>{n++;throw {kind:'transient'};});await c.open(row);for(const keyRevision of ['1','2','3','4'])await c.open(row,{keyRevision});assert.equal(n,3);});
test('failed persistence never displays text',async()=>{const c=make(async()=>{throw {kind:'storage'};});await c.open(row);assert.equal(c.bodies.size,0);});
test('read receipt stops at unreadable row',async()=>{let receipt;const c=make(async()=> '{}',async(_,id)=>receipt=id);await c.open(row);await c.open({id:'3',senderId:'b'});await c.markOpenedRead([row,{id:'2',senderId:'b'},{id:'3',senderId:'b'}],'a');assert.equal(receipt,'1');});
test('locked thread does not open',async()=>{let n=0;const c=make(async()=>{n++;return '{}';});c.enter(scope,false);await c.open(row);assert.equal(n,0);});
test('view marks a transient failure retryable and a tampered one not',async()=>{const kinds={1:'transient',2:'authentication'};const c=make(async(_,r)=>{throw {kind:kinds[r.id]};});await c.open(row);await c.open({id:'2',senderId:'b'});const v=c.view();assert.deepEqual(v['1'],{state:'unreadable',retryable:true,code:'OPEN_FAILED'});assert.deepEqual(v['2'],{state:'unreadable',code:'OPEN_FAILED'});});
test('seed shows an own message only while live; receipt is not repeated',async()=>{const sent=[];const c=make(async()=> '{}',async(_,id)=>sent.push(id));c.seed('9',{type:'text',text:'x'});assert.equal(c.body('9').state,'open');await c.open(row);await c.markOpenedRead([row],'a');await c.markOpenedRead([row],'a');assert.deepEqual(sent,['1']);c.enter(scope,false);c.seed('8',{});assert.equal(c.bodies.size,0);});
