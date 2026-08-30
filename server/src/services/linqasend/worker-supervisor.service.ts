import type { Database } from "../../db/pool.js";
import type { LinqaSendProviders } from "../../integrations/linqasend/provider.contracts.js";
import { reconcileInFlightTransfers } from "../../integrations/linqasend/reconciliation.js";
import type { TransferOrchestratorService } from "./transfer-orchestrator.service.js";
import { LinqaSendExecutionQueue } from "./execution-queue.service.js";
import { WebhookInboxService } from "./webhook-inbox.service.js";

export const LINQASEND_WORKERS = ["execution","webhook","notifications","reconciliation","break-escalation","suspense-aging","liquidity","certification-expiry","stuck-transfer","automatic-pause"] as const;
export type LinqaSendWorkerName = typeof LINQASEND_WORKERS[number];

/** Supervised one-shot jobs; deployment calls each repeatedly and readiness checks heartbeats. */
export class LinqaSendWorkerSupervisor {
  private readonly queue: LinqaSendExecutionQueue;
  private readonly inbox: WebhookInboxService;
  constructor(private readonly db:Database,private readonly orchestrator:TransferOrchestratorService,private readonly providers:LinqaSendProviders,leaseSeconds=60){this.queue=new LinqaSendExecutionQueue(db,leaseSeconds);this.inbox=new WebhookInboxService(db);}
  async runOnce(name:LinqaSendWorkerName,instanceId:string):Promise<void>{
    await this.queue.heartbeat(name,instanceId);
    if(name==="execution"){
      const claim=await this.queue.claim(instanceId); if(!claim)return;
      try{await this.queue.running(claim.id,instanceId);await this.orchestrator.runClaimedExecution(claim);await this.queue.succeeded(claim.id);}catch(error){await this.queue.failed(claim.id,error);throw error;}
    }else if(name==="webhook"){
      const item=await this.inbox.claim(instanceId);if(item)await this.inbox.process(item);
    }else if(name==="reconciliation"){
      const result=await reconcileInFlightTransfers(this.db,this.providers);await this.metric("reconciliation_mismatches","GLOBAL","*",Number((result as any).mismatchCount??(result as any).mismatches?.length??0));
    }else if(name==="notifications"){
      const r=await this.db.query(`SELECT count(*)::int AS count FROM linqasend_notification_outbox_v1 WHERE status='PENDING' AND available_at<now()-interval '5 minutes'`);if(Number(r.rows[0]?.count)>0)await this.alert("HIGH","NOTIFICATION_BACKLOG","GLOBAL","*",r.rows[0]);
    }else if(name==="break-escalation"){
      const r=await this.db.query(`SELECT count(*)::int AS count FROM linqasend_reconciliation_breaks_v5 WHERE status NOT IN ('RESOLVED','CLOSED') AND severity IN ('HIGH','CRITICAL')`);if(Number(r.rows[0]?.count)>0)await this.alert("CRITICAL","RECONCILIATION_BREAKS","GLOBAL","*",r.rows[0]);
    }else if(name==="suspense-aging"){
      const r=await this.db.query(`SELECT count(*)::int AS count FROM linqasend_suspense_items_v5 WHERE status='OPEN' AND created_at<now()-interval '24 hours'`);if(Number(r.rows[0]?.count)>0)await this.alert("HIGH","AGED_SUSPENSE","GLOBAL","*",r.rows[0]);
    }else if(name==="liquidity"){
      const rows=await this.db.query(`SELECT p.currency,p.available_liquidity_minor,l.min_available_minor FROM linqasend_treasury_positions_v5 p JOIN LATERAL(SELECT min_available_minor FROM linqasend_liquidity_policies_v5 WHERE currency=p.currency AND effective_from<=now() AND(effective_to IS NULL OR effective_to>now()) ORDER BY version DESC LIMIT 1)l ON true WHERE p.position_date=current_date AND p.available_liquidity_minor<l.min_available_minor`);for(const row of rows.rows)await this.alert("CRITICAL","LIQUIDITY_BELOW_MINIMUM","CURRENCY",row.currency,row);
    }else if(name==="certification-expiry"){
      const rows=await this.db.query(`SELECT provider_id,expires_at FROM linqasend_provider_certifications_v6 WHERE status='CERTIFIED' AND expires_at<now()+interval '14 days'`);for(const row of rows.rows)await this.alert("HIGH","PROVIDER_CERTIFICATION_EXPIRING","PROVIDER",row.provider_id,row);
    }else if(name==="stuck-transfer"){
      const rows=await this.db.query(`SELECT id,public_id,status FROM linqasend_transfers WHERE status NOT IN ('COMPLETED','DECLINED','CANCELED','EXPIRED','FAILED','REVERSED','REFUNDED','CHARGEBACK') AND updated_at<now()-interval '30 minutes' LIMIT 100`);for(const row of rows.rows)await this.alert("HIGH","STUCK_TRANSFER","TRANSFER",row.id,row);
    }else if(name==="automatic-pause") await this.evaluateAutomaticPauses();
  }
  private async metric(name:string,scopeType:string,scopeId:string,value:number){await this.db.query(`INSERT INTO linqasend_control_metrics(metric_name,scope_type,scope_id,metric_value,window_start,window_end) VALUES($1,$2,$3,$4,now()-interval '15 minutes',now())`,[name,scopeType,scopeId,value]);}
  private async alert(severity:string,type:string,subjectType:string,subjectId:string,details:unknown){await this.db.query(`INSERT INTO linqasend_operational_alerts(severity,alert_type,subject_type,subject_id,details) SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM linqasend_operational_alerts WHERE alert_type=$2 AND subject_type=$3 AND subject_id=$4 AND status='OPEN')`,[severity,type,subjectType,subjectId,JSON.stringify(details)]);}
  private async evaluateAutomaticPauses(){
    const client=await this.db.connect();try{await client.query("BEGIN");const rows=await client.query(`SELECT r.*,m.id AS metric_id,m.metric_value FROM linqasend_automatic_pause_rules r JOIN LATERAL(SELECT id,metric_value FROM linqasend_control_metrics WHERE metric_name=r.metric_name AND scope_type=r.scope_type AND scope_id=r.scope_id ORDER BY calculated_at DESC LIMIT 1)m ON true WHERE r.active AND CASE r.comparison WHEN 'GT' THEN m.metric_value>r.threshold WHEN 'GTE' THEN m.metric_value>=r.threshold WHEN 'LT' THEN m.metric_value<r.threshold WHEN 'LTE' THEN m.metric_value<=r.threshold END FOR UPDATE OF r`);for(const row of rows.rows){const inserted=await client.query(`INSERT INTO linqasend_automatic_pause_actions(rule_id,metric_id,kill_scope_type,kill_scope_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`,[row.id,row.metric_id,row.scope_type,row.scope_id]);if(inserted.rowCount)await client.query(`INSERT INTO linqasend_kill_switches(scope_type,scope_id,active,reason,activated_at) VALUES($1,$2,true,$3,now()) ON CONFLICT(scope_type,scope_id) DO UPDATE SET active=true,reason=excluded.reason,activated_at=now(),cleared_at=NULL`,[row.scope_type,row.scope_id,`automatic pause: ${row.metric_name} ${row.comparison} ${row.threshold}`]);}await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
}
