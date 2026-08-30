import type { PoolClient } from 'pg';
export async function writeAudit(db:PoolClient,e:{actorStaffId:string;actorSessionId?:string;action:string;resourceType:string;resourceId:string;reasonCode?:string;correlationId:string;ipHash?:string;metadata?:unknown}){
 await db.query(`INSERT INTO ops_audit_log(actor_staff_id,actor_session_id,action,resource_type,resource_id,reason_code,correlation_id,ip_hash,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[e.actorStaffId,e.actorSessionId??null,e.action,e.resourceType,e.resourceId,e.reasonCode??null,e.correlationId,e.ipHash??null,JSON.stringify(e.metadata??{})]);
}
