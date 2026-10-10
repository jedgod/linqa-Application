import { DatabaseSync } from 'node:sqlite';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const scopeKey = s => {
 for (const key of ['accountId','deviceId','conversationId']) if(typeof s[key]!=='string'||!s[key].trim()) throw Object.assign(new Error('DEVICE_SCOPE_REQUIRED'),{code:'DEVICE_SCOPE_REQUIRED'});
 return JSON.stringify([s.accountId,s.deviceId,s.conversationId]);
};
export class DurableStore {
 constructor(path,key,core) {
  if(!Buffer.isBuffer(key)||key.length!==32) throw new Error('STORAGE_KEY_REQUIRED');
  this.key=key;this.core=core;this.db=new DatabaseSync(path);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS core_state(scope TEXT PRIMARY KEY,state BLOB NOT NULL);
   CREATE TABLE IF NOT EXISTS inbox(scope TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,sealed BLOB NOT NULL,PRIMARY KEY(scope,id));`);
 }
 seal(bytes,aad){const nonce=randomBytes(12);const c=createCipheriv('aes-256-gcm',this.key,nonce);c.setAAD(Buffer.from(aad));return Buffer.concat([nonce,c.update(bytes),c.final(),c.getAuthTag()]);}
 unseal(bytes,aad){const b=Buffer.from(bytes);const d=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));d.setAAD(Buffer.from(aad));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]);}
 readOrOpenAndCommit(scope,row,{fault=()=>{}}={}) {
  const sk=scopeKey(scope);const stateKey=JSON.stringify([scope.accountId,scope.deviceId]);if(!row.id)throw new Error('MESSAGE_ID_REQUIRED');
  const bytes=Buffer.from(row.envelope);const hash=digest(bytes);const aad=JSON.stringify([sk,row.id,hash,1]);
  this.db.exec('BEGIN IMMEDIATE');
  try {
   const old=this.db.prepare('SELECT digest,sealed FROM inbox WHERE scope=? AND id=?').get(sk,row.id);
   if(old){if(old.digest!==hash)throw Object.assign(new Error('ENVELOPE_CHANGED'),{code:'ENVELOPE_CHANGED'});const text=this.unseal(old.sealed,aad).toString('utf8');this.db.exec('COMMIT');return text;}
   const saved=this.db.prepare('SELECT state FROM core_state WHERE scope=?').get(stateKey);
   const state=saved?this.unseal(saved.state,JSON.stringify([stateKey,'core-state',1])):null;
   // prepareOpen is pure: no persistent or global ratchet/replay mutation.
   const staged=this.core.prepareOpen(scope,bytes,state);
   if(staged&&typeof staged.then==='function')throw new Error('ASYNC_CORE_UNSUPPORTED');
   const payload=Buffer.from(staged.text,'utf8');
   fault('afterPrepare');
   this.db.prepare('INSERT INTO inbox VALUES(?,?,?,?)').run(sk,row.id,hash,this.seal(payload,aad));
   fault('afterInbox');
   this.db.prepare('INSERT INTO core_state VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET state=excluded.state').run(stateKey,this.seal(staged.nextState,JSON.stringify([stateKey,'core-state',1])));
   fault('afterState');this.db.exec('COMMIT');return staged.text;
  } catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 close(){this.db.close();this.key.fill(0);}
}
