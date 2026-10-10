import type {Pool} from 'pg'; import type {ObjectStore} from './contracts.js';
export async function purgeExpiredQuarantine(db:Pool,store:ObjectStore){
 const r=await db.query(`SELECT id,object_key FROM vault_quarantine_objects WHERE expires_at<now() AND state NOT IN('PURGED') LIMIT 100 FOR UPDATE SKIP LOCKED`);
 for(const x of r.rows){await store.delete(x.object_key).catch(()=>{});await db.query(`UPDATE vault_quarantine_objects SET state='PURGED',updated_at=now() WHERE id=$1`,[x.id]);}
}
export async function heartbeat(db:Pool,worker:string,sha:string,digest:string){
 await db.query(`INSERT INTO vault_worker_heartbeats(worker,git_sha,artifact_digest,heartbeat_at) VALUES($1,$2,$3,now())
 ON CONFLICT(worker) DO UPDATE SET git_sha=excluded.git_sha,artifact_digest=excluded.artifact_digest,heartbeat_at=now()`,[worker,sha,digest]);
}
