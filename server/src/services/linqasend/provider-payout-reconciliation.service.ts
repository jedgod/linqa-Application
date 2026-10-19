import type { Database } from '../../db/pool.js';
import type { LinqaSendProviders } from '../../integrations/linqasend/provider.contracts.js';
import { AtomicCompletionService } from './atomic-completion.service.js';

/** Queries existing operations only. It never creates/retries a payout or invents custody from a balance change. */
export class ProviderPayoutReconciliationService {
  constructor(private readonly db:Database,private readonly providers:LinqaSendProviders){}
  async runOnce() {
    const rows=await this.db.query(`SELECT o.id AS operation_id,o.idempotency_key,o.provider_reference,t.id,t.public_id,t.provider,t.status,r.recipient_type
      FROM linqasend_provider_operations o JOIN linqasend_transfers t ON t.id=o.transfer_id AND t.provider=o.provider_id
      JOIN linqasend_recipients r ON r.id=t.recipient_id WHERE o.operation_type='PAYOUT' AND o.state IN ('UNKNOWN','SUBMITTED','SUCCEEDED')
      AND (t.status IN ('PROCESSING','PAYOUT_SUBMITTED','PAYOUT_PROCESSING') OR (t.status='COMPLETED' AND r.recipient_type='LINQA_USER' AND t.wallet_credit_evidence IS NULL))
      ORDER BY o.updated_at LIMIT 100`);
    let completed=0;
    for(const row of rows.rows){try{
      const result=row.provider_reference?await this.providers.payout.lookup(row.provider_reference):await this.providers.payout.lookupByIdempotencyKey?.(row.idempotency_key)??null;
      if(!result)continue;
      if(!result.providerRef||(row.provider_reference&&result.providerRef!==row.provider_reference))throw new Error('PAYOUT_LOOKUP_REFERENCE_MISMATCH');
      // Persist the found identity before any separate receipt lookup; a missing receipt must not lose payout evidence.
      await this.db.query(`UPDATE linqasend_provider_operations SET provider_reference=$2,response_metadata=$3,updated_at=now() WHERE id=$1`,[row.operation_id,result.providerRef,JSON.stringify(result)]);
      let evidence=result.walletCredit;
      if(result.status==='COMPLETED'&&row.recipient_type==='LINQA_USER'&&!evidence){
        const receipt=await this.providers.custody?.lookupReceipt(row.idempotency_key);
        if(!receipt)throw new Error('CUSTODY_RECEIPT_NOT_AVAILABLE');
        if(receipt.status!=='SETTLED'||receipt.providerId!==row.provider||receipt.transferId!==row.public_id||receipt.providerRef!==result.providerRef)throw new Error('CUSTODY_RECEIPT_MISMATCH');
        evidence=receipt.walletCredit;
      }
      await this.db.query(`UPDATE linqasend_provider_operations SET state=$2,provider_reference=$3,response_metadata=$4,updated_at=now() WHERE id=$1`,
        [row.operation_id,result.status==='FAILED'?'FAILED':'SUCCEEDED',result.providerRef,JSON.stringify({...result,...(evidence?{walletCredit:evidence}:{})})]);
      if(result.status==='COMPLETED'){
        await new AtomicCompletionService(this.db).complete({transferId:row.id,providerReference:result.providerRef,source:'RECONCILIATION_WORKER',...(evidence?{walletCredit:evidence}:{})});completed++;
      }else if(result.status==='FAILED'){
        await this.db.query(`UPDATE linqasend_transfers SET status='FAILED',failure_code='PAYOUT_REJECTED_REQUIRES_FUNDING_RECONCILIATION',updated_at=now() WHERE id=$1 AND status IN ('PROCESSING','PAYOUT_SUBMITTED','PAYOUT_PROCESSING')`,[row.id]);
        await this.db.query(`INSERT INTO linqasend_operational_alerts(severity,alert_type,subject_type,subject_id,details)
          SELECT 'HIGH','PAYOUT_FAILED_REQUIRES_FUNDING_RECONCILIATION','TRANSFER',$1,'{}'::jsonb WHERE NOT EXISTS(SELECT 1 FROM linqasend_operational_alerts WHERE alert_type='PAYOUT_FAILED_REQUIRES_FUNDING_RECONCILIATION' AND subject_id=$1 AND status='OPEN')`,[row.id]);
      }
    }catch{
      await this.db.query(`INSERT INTO linqasend_operational_alerts(severity,alert_type,subject_type,subject_id,details)
        SELECT 'HIGH','PAYOUT_CUSTODY_LOOKUP_FAILED','TRANSFER',$1,'{}'::jsonb WHERE NOT EXISTS(SELECT 1 FROM linqasend_operational_alerts
        WHERE alert_type='PAYOUT_CUSTODY_LOOKUP_FAILED' AND subject_id=$1 AND status='OPEN')`,[row.id]);
    }}
    return {checked:rows.rows.length,completed};
  }
}
