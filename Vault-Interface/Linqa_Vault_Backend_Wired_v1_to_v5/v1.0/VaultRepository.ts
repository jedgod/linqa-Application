import {Pool,PoolClient} from 'pg';
export class VaultRepository{
 constructor(private db:Pool){}
 async tx<T>(fn:(c:PoolClient)=>Promise<T>){const c=await this.db.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
 async requireWorkspace(c:PoolClient,workspaceId:string,userId:string){
  const r=await c.query(`SELECT w.* FROM vault_workspaces w WHERE w.id=$1 AND w.status='ACTIVE' AND (w.owner_user_id=$2 OR EXISTS(SELECT 1 FROM vault_workspace_members m WHERE m.workspace_id=w.id AND m.user_id=$2 AND m.status='ACTIVE')) FOR UPDATE`,[workspaceId,userId]);
  if(!r.rowCount) throw Object.assign(new Error('VAULT_WORKSPACE_FORBIDDEN'),{status:403}); return r.rows[0];
 }
 async reserve(c:PoolClient,workspaceId:string,bytes:number){
  const r=await c.query(`UPDATE vault_workspaces SET reserved_bytes=reserved_bytes+$2,updated_at=now() WHERE id=$1 AND used_bytes+reserved_bytes+$2<=quota_bytes RETURNING *`,[workspaceId,bytes]);
  if(!r.rowCount) throw Object.assign(new Error('VAULT_QUOTA_EXCEEDED'),{status:409}); return r.rows[0];
 }
}
