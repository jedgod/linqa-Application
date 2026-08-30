import type { Database } from "../../db/pool.js";

export class LinqaSendExecutionQueue {
  constructor(private readonly db: Database, private readonly leaseSeconds = 60) {}
  async enqueue(transferId: string, context: Record<string, unknown>): Promise<string> {
    const result = await this.db.query(`INSERT INTO linqasend_transfer_executions(transfer_id,execution_context) VALUES($1,$2) ON CONFLICT(transfer_id) DO UPDATE SET execution_context=excluded.execution_context WHERE linqasend_transfer_executions.state='QUEUED' RETURNING id`, [transferId,JSON.stringify(context)]);
    if (!result.rows[0]) throw new Error("TRANSFER_EXECUTION_ALREADY_STARTED");
    await this.db.query(`UPDATE linqasend_transfers SET execution_id=$2,updated_at=now() WHERE id=$1`,[transferId,result.rows[0].id]);
    return result.rows[0].id as string;
  }
  async claim(workerId: string): Promise<{id:string;transferId:string;context:any}|null> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`SELECT * FROM linqasend_transfer_executions WHERE ((state IN ('QUEUED','WAITING') AND available_at<=now()) OR (state IN ('LEASED','RUNNING') AND lease_expires_at<now())) AND attempt_count<max_attempts ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
      const row=result.rows[0]; if(!row){await client.query("COMMIT");return null;}
      await client.query(`UPDATE linqasend_transfer_executions SET state='LEASED',leased_by=$2,lease_expires_at=now()+($3::text||' seconds')::interval,attempt_count=attempt_count+1,updated_at=now() WHERE id=$1`,[row.id,workerId,this.leaseSeconds]);
      await client.query("COMMIT"); return{id:row.id,transferId:row.transfer_id,context:row.execution_context};
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
  async running(id:string,workerId:string){const result=await this.db.query(`UPDATE linqasend_transfer_executions SET state='RUNNING',updated_at=now() WHERE id=$1 AND state='LEASED' AND leased_by=$2 AND lease_expires_at>now()`,[id,workerId]);if(!result.rowCount)throw new Error("EXECUTION_LEASE_LOST");}
  async succeeded(id:string){await this.db.query(`UPDATE linqasend_transfer_executions SET state='SUCCEEDED',leased_by=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[id]);}
  async failed(id:string,error:unknown){await this.db.query(`UPDATE linqasend_transfer_executions SET state=CASE WHEN attempt_count>=max_attempts THEN 'DEAD_LETTER' ELSE 'WAITING' END,available_at=now()+least(attempt_count,10)*interval '1 minute',last_error_code='EXECUTION_FAILED',last_error_message=$2,leased_by=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[id,error instanceof Error?error.message:"unknown"]);}
  async heartbeat(workerName:string,instanceId:string,details:Record<string,unknown>={}){await this.db.query(`INSERT INTO linqasend_worker_heartbeats(worker_name,instance_id,status,last_heartbeat_at,details) VALUES($1,$2,'READY',now(),$3) ON CONFLICT(worker_name,instance_id) DO UPDATE SET status='READY',last_heartbeat_at=now(),details=excluded.details`,[workerName,instanceId,JSON.stringify(details)]);}
}
