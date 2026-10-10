import test from 'node:test';import assert from 'node:assert/strict';
import {createPostgresRepository} from '../server/postgres.mjs';
test('repository refuses missing atomic authorization hook',()=>assert.throws(()=>createPostgresRepository({}),/authorization/));
test('transactional rejection rolls back before envelope persistence',async()=>{
 const calls=[];const c={query:async sql=>{calls.push(sql);return{rows:[]};},release:()=>{calls.push('RELEASE');}};
 const repo=createPostgresRepository({connect:async()=>c},async tx=>{assert.equal(tx,c);throw Error('DEVICE_REVOKED');});
 await assert.rejects(repo.append('conversation',{userId:'a'}, {clientId:'client',envelopes:[]},'event'),/REVOKED/);
 assert.deepEqual(calls,['BEGIN','ROLLBACK','RELEASE']);
});
