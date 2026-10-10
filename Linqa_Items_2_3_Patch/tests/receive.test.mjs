import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReceiveController } from '../receive-controller.mjs';
const scope = { accountId: 'a', deviceId: 'd', conversationId: 'c' };
const row = { id: '1', senderId: 'b' };
function make(open, markRead = async()=>{}) {
 const c = new ReceiveController({readOrOpenAndCommit:open, classify:e=>e.kind, safeCode:()=> 'OPEN_FAILED', markRead}, JSON.parse);
 c.enter(scope,true); return c;
}
test('committed payload opens',async()=>{const c=make(async()=>'{"type":"text","text":"hello"}');await c.open(row);assert.equal(c.body('1').state,'open');});
test('lock and unlock invalidates old decrypt',async()=>{let resolve;const c=make(()=>new Promise(r=>resolve=r));const p=c.open(row);c.enter(scope,false);c.enter(scope,true);resolve('{}');await p;assert.equal(c.bodies.size,0);});
test('account switch invalidates old decrypt',async()=>{let resolve;const c=make(()=>new Promise(r=>resolve=r));const p=c.open(row);c.enter({...scope,accountId:'other'},true);resolve('{}');await p;assert.equal(c.bodies.size,0);});
test('tampering remains blocked even with explicit retry',async()=>{let n=0;const c=make(async()=>{n++;throw {kind:'authentication'};});await c.open(row);await c.open(row,{explicit:true});assert.equal(n,1);});
test('transient failure has explicit retry',async()=>{let n=0;const c=make(async()=>{if(++n===1)throw {kind:'transient'};return '{}';});await c.open(row);await c.open(row);assert.equal(n,1);await c.open(row,{explicit:true});assert.equal(c.body('1').state,'open');});
test('key revisions bound automatic retries',async()=>{let n=0;const c=make(async()=>{n++;throw {kind:'transient'};});await c.open(row);for(const keyRevision of ['1','2','3','4'])await c.open(row,{keyRevision});assert.equal(n,3);});
test('failed persistence never displays text',async()=>{const c=make(async()=>{throw {kind:'storage'};});await c.open(row);assert.equal(c.bodies.size,0);});
test('read receipt stops at unreadable row',async()=>{let receipt;const c=make(async()=> '{}',async(_,id)=>receipt=id);await c.open(row);await c.open({id:'3',senderId:'b'});await c.markOpenedRead([row,{id:'2',senderId:'b'},{id:'3',senderId:'b'}],'a');assert.equal(receipt,'1');});
test('locked thread does not open',async()=>{let n=0;const c=make(async()=>{n++;return '{}';});c.enter(scope,false);await c.open(row);assert.equal(n,0);});
