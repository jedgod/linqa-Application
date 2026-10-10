import type {Outbox,Queued} from './secure-send.ts';
// Universal storage contract for SQLite (mobile/desktop) or IndexedDB (web).
// The host must implement atomic durable transactions, not localStorage.
export interface AtomicStore {
 insertIfAbsent(key:string,value:string):Promise<void>;
 scanPrefix(prefix:string):Promise<{key:string;value:string}[]>;
 delete(key:string):Promise<void>;
}
export function durableOutbox(store:AtomicStore):Outbox {
 if(!store?.insertIfAbsent||!store?.scanPrefix||!store?.delete)throw Error('DURABLE_STORE_REQUIRED');
 const prefix=(a:string,d:string)=>`linqa-send:${encodeURIComponent(a)}:${encodeURIComponent(d)}:`;
 return {
  put:row=>store.insertIfAbsent(prefix(row.accountId,row.deviceId)+row.batch.clientId,JSON.stringify(row)),
  list:async(a,d)=>(await store.scanPrefix(prefix(a,d))).map(r=>JSON.parse(r.value) as Queued),
  remove:(a,d,id)=>store.delete(prefix(a,d)+id)
 };
}
