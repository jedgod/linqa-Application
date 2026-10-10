import {durableOutbox} from './durableOutbox.ts';
import type {AtomicStore} from './durableOutbox.ts';
// Actual browser durable store; Electron renderer can use this only inside its
// trusted origin. Do not load remote content in a privileged Electron renderer.
export async function browserOutbox(indexedDB:IDBFactory){
 if(!indexedDB)throw Error('INDEXEDDB_REQUIRED');
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{
  const req=indexedDB.open('linqa-encrypted-outbox-v2',1);
  req.onupgradeneeded=()=>{req.result.createObjectStore('queue');};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  req.onblocked=()=>reject(Error('OUTBOX_UPGRADE_BLOCKED'));
 });
 function tx<T>(mode:IDBTransactionMode,fn:(s:IDBObjectStore,done:(v:T)=>void)=>void){return new Promise<T>((resolve,reject)=>{
  const t=db.transaction('queue',mode);let value:T;
  t.oncomplete=()=>resolve(value);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('OUTBOX_ABORTED'));
  try{fn(t.objectStore('queue'),v=>{value=v;});}catch(e){t.abort();reject(e);}
 });}
 const store:AtomicStore={
  insertIfAbsent:(key,value)=>tx<void>('readwrite',(s,done)=>{const r=s.get(key);r.onsuccess=()=>{if(r.result===undefined)s.add(value,key);done(undefined);};}),
  scanPrefix:prefix=>tx('readonly',(s,done)=>{const rows:{key:string;value:string}[]=[];const r=s.openCursor();r.onsuccess=()=>{const cursor=r.result;if(!cursor){done(rows);return;}if(typeof cursor.key==='string'&&cursor.key.startsWith(prefix))rows.push({key:cursor.key,value:String(cursor.value)});cursor.continue();};}),
  delete:key=>tx<void>('readwrite',(s,done)=>{s.delete(key);done(undefined);})
 };
 return {outbox:durableOutbox(store),close:()=>db.close()};
}
