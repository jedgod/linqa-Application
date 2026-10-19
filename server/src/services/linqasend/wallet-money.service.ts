import { createHash,randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Database } from '../../db/pool.js';
import { canonical } from '../../security/biometrics/canonical.js';
import { checkedPricing,moneySnapshot,moneyOutcome,type MoneyRequest,type MoneySnapshot,type MoneyOutcome,type WalletMoneyGateway } from '../../integrations/linqasend/wallet-money.contracts.js';
import { WalletLedgerService } from './wallet-ledger.service.js';
import { denyWalletMoneyPolicy,type WalletMoneyPolicy } from './wallet-money-policy.js';

export const moneyHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
type Reader=Pick<PoolClient,'query'>;
export class WalletMoneyService {
  private ledger:WalletLedgerService;
  constructor(private db:Database,private gateway?:WalletMoneyGateway,private policy:WalletMoneyPolicy=denyWalletMoneyPolicy){this.ledger=new WalletLedgerService(db);}
  private async tx<T>(work:(c:PoolClient)=>Promise<T>){const c=await this.db.connect();try{await c.query('BEGIN');const result=await work(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async open(userId:string,currency:string){
    return this.tx(async c=>{
      const p=(await c.query(`SELECT p.* FROM user_jurisdiction_profiles_v2 p JOIN users u ON u.id=p.user_id AND u.status='ACTIVE'
        JOIN linqasend_financial_entities_v7 e ON e.id=p.regulatory_entity_id AND e.status='ACTIVE' AND e.due_diligence_status='APPROVED' WHERE p.user_id=$1 FOR SHARE OF p,u,e`,[userId])).rows[0];
      if(!p)throw new Error('WALLET_PROFILE_REQUIRED');
      await c.query(`INSERT INTO linqasend_wallet_accounts_v2(user_id,jurisdiction,regulatory_entity_id,currency,jurisdiction_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,jurisdiction,currency,jurisdiction_version) DO NOTHING`,[userId,p.regulatory_jurisdiction,p.regulatory_entity_id,currency,p.jurisdiction_version]);
      const w=(await c.query(`SELECT * FROM linqasend_wallet_accounts_v2 WHERE user_id=$1 AND jurisdiction=$2 AND currency=$3 AND jurisdiction_version=$4 FOR UPDATE`,[userId,p.regulatory_jurisdiction,currency,p.jurisdiction_version])).rows[0];
      if(w.status!=='ACTIVE'||w.regulatory_entity_id!==p.regulatory_entity_id)throw new Error('WALLET_NOT_ACTIVE');
      if(!w.subledger_enabled&&['available_balance_minor','held_balance_minor','pending_balance_minor','ledger_balance_minor','withdrawable_balance_minor'].some(k=>BigInt(w[k])!==0n))throw new Error('LEGACY_WALLET_RECONCILIATION_REQUIRED');
      await c.query(`UPDATE linqasend_wallet_accounts_v2 SET subledger_enabled=true WHERE id=$1`,[w.id]);
      return {id:w.id,currency};
    });
  }
  private async context(userId:string,input:MoneyRequest,q:Reader=this.db){
    const w=(await q.query(`SELECT * FROM linqasend_wallet_accounts_v2 WHERE id=$1 AND user_id=$2 AND status='ACTIVE' AND subledger_enabled`,[input.walletId,userId])).rows[0];
    if(!w)throw new Error('WALLET_NOT_ACTIVE');
    let target:any,reference:string;
    if(input.kind==='WITHDRAW'||input.kind==='TOPUP'){
      target=(await q.query(`SELECT m.*,b.currency AS target_currency FROM linqasend_payment_methods m JOIN linqasend_verified_bank_capabilities b ON b.payment_method_id=m.id AND b.user_id=m.user_id AND b.provider_id=m.provider AND b.country=m.billing_country
        WHERE m.id=$1 AND m.user_id=$2 AND m.deleted_at IS NULL AND m.verification_status='VERIFIED' AND m.type::text IN ('BANK_ACCOUNT','DEBIT_CARD')
        AND b.expires_at>now() AND b.currency=$3 AND b.country=$4 AND CASE WHEN $5='TOPUP' THEN b.funding_enabled ELSE b.payout_enabled END`,[input.targetId,userId,w.currency,w.jurisdiction,input.kind])).rows[0];
      if(!target)throw new Error('VERIFIED_OWNED_BANK_OR_CARD_REQUIRED');
      reference=target.provider_payment_method_ref;
      target={...target,country:target.billing_country,currency:target.target_currency.trim(),provider:target.provider,targetWalletId:null};
    }else{
      target=(await q.query(`SELECT * FROM linqasend_recipients WHERE id=$1 AND owner_user_id=$2`,[input.targetId,userId])).rows[0];
      if(!target)throw new Error('WALLET_RECIPIENT_NOT_FOUND');
      if(input.kind==='INTERNAL'){
        if(target.recipient_type!=='LINQA_USER'||target.linqa_user_id===userId)throw new Error('WALLET_INTERNAL_RECIPIENT_INVALID');
        const receiver=(await q.query(`SELECT w.* FROM linqasend_wallet_accounts_v2 w JOIN user_jurisdiction_profiles_v2 p ON p.user_id=w.user_id AND p.jurisdiction_version=w.jurisdiction_version AND p.regulatory_entity_id=w.regulatory_entity_id AND p.regulatory_jurisdiction=w.jurisdiction
          WHERE w.user_id=$1 AND w.regulatory_entity_id=$2 AND w.currency=$3 AND w.jurisdiction=$4 AND w.status='ACTIVE' AND w.subledger_enabled`,[target.linqa_user_id,w.regulatory_entity_id,w.currency,w.jurisdiction])).rows[0];
        if(!receiver)throw new Error('RECIPIENT_WALLET_SAME_ENTITY_REQUIRED');
        const a=(await q.query(`SELECT provider_id FROM linqasend_provider_custody_accounts WHERE regulatory_entity_id=$1 AND currency=$2 AND active ORDER BY provider_id LIMIT 1`,[w.regulatory_entity_id,w.currency])).rows[0];
        if(!a)throw new Error('CUSTODY_ACCOUNTS_NOT_CONFIGURED');
        reference=receiver.id;target={...target,country:receiver.jurisdiction,currency:receiver.currency.trim(),provider:a.provider_id,targetWalletId:receiver.id};
      }else{
        if(!['BANK','BANK_ACCOUNT','CARD','MOBILE_WALLET'].includes(target.recipient_type)||!target.payout_provider||!target.payout_profile_ref?.startsWith('vault:'))throw new Error('WALLET_EXTERNAL_DESTINATION_INVALID');
        const endpoint=await q.query(`SELECT 1 FROM linqasend_payout_endpoints_v1 p JOIN linqasend_external_recipients_v1 e ON e.id=p.external_recipient_id WHERE e.id=$1 AND e.owner_user_id=$2 AND e.verification_status='VERIFIED' AND p.provider=$3 AND p.provider_token=$4 AND p.status='ACTIVE' AND p.country_code=$5 AND p.currency=$6`,[target.external_recipient_id,userId,target.payout_provider,target.payout_profile_ref,target.country,target.preferred_currency]);
        if(!endpoint.rowCount)throw new Error('WALLET_EXTERNAL_DESTINATION_UNVERIFIED');
        reference=target.payout_profile_ref;target={...target,currency:target.preferred_currency.trim(),provider:target.payout_provider,targetWalletId:null};
      }
    }
    return {wallet:w,target,reference,hash:moneyHash({reference,country:target.country,currency:target.currency,provider:target.provider,targetWalletId:target.targetWalletId,type:target.type??target.recipient_type})};
  }
  async quote(userId:string,input:MoneyRequest){
    const {wallet:w,target:t,reference,hash}=await this.context(userId,input),id=randomUUID();
    let pricing;
    if(input.kind==='INTERNAL')pricing={quoteId:null,amountMinor:input.amountMinor,currency:w.currency.trim(),feeMinor:'0',totalMinor:input.amountMinor,receiveAmountMinor:input.amountMinor,receiveCurrency:w.currency.trim(),expiresAt:new Date(Date.now()+90_000).toISOString(),estimatedArrival:'On successful authorization',fxRate:'1'};
    else {
      if(!this.gateway)throw new Error('WALLET_MONEY_GATEWAY_REQUIRED');
      const caps=await this.gateway.capabilities();
      if(!caps.returns||!caps.refunds||!(input.kind==='TOPUP'?caps.settledTopups:input.kind==='WITHDRAW'?caps.amountWithdrawals:caps.externalPayments))throw new Error('WALLET_MONEY_GATEWAY_CAPABILITY_MISSING');
      pricing=checkedPricing(await this.gateway.quote({operationId:id,kind:input.kind,userId,amountMinor:input.amountMinor,currency:w.currency.trim(),receiveCurrency:t.currency,targetReference:await this.policy.resolve(reference,userId),entityId:w.regulatory_entity_id}),input.amountMinor,w.currency.trim(),t.currency,input.kind);
    }
    const snapshot=moneySnapshot.parse({id,userId,walletId:w.id,kind:input.kind,amountMinor:pricing.amountMinor,feeMinor:pricing.feeMinor,totalMinor:pricing.totalMinor,currency:pricing.currency,receiveAmountMinor:pricing.receiveAmountMinor,receiveCurrency:pricing.receiveCurrency,entityId:w.regulatory_entity_id,country:w.jurisdiction,jurisdictionVersion:w.jurisdiction_version,targetId:input.targetId,targetCountry:t.country,targetHash:hash,targetWalletId:t.targetWalletId,providerId:t.provider,providerQuoteId:pricing.quoteId,expiresAt:pricing.expiresAt,estimatedArrival:pricing.estimatedArrival,fxRate:pricing.fxRate});
    await this.policy.authorize(snapshot);
    await this.db.query(`INSERT INTO linqasend_wallet_money_quotes(id,user_id,wallet_id,snapshot,destination_ref,expires_at) VALUES($1,$2,$3,$4,$5,$6)`,[id,userId,w.id,JSON.stringify(snapshot),input.kind==='INTERNAL'?null:reference,snapshot.expiresAt]);
    return snapshot;
  }
  async submit(userId:string,quoteId:string,authorize:(c:PoolClient,s:MoneySnapshot)=>Promise<void|{deviceId:string;sessionId:string;installationId:string}>){
    return this.tx(async c=>{
      const prior=(await c.query(`SELECT id,status FROM linqasend_wallet_money_operations WHERE id=$1 AND user_id=$2`,[quoteId,userId])).rows[0];if(prior)return prior;
      const row=(await c.query(`SELECT * FROM linqasend_wallet_money_quotes WHERE id=$1 AND user_id=$2 FOR UPDATE`,[quoteId,userId])).rows[0];
      if(!row)throw new Error('WALLET_QUOTE_EXPIRED_OR_NOT_OWNED');
      const completed=(await c.query(`SELECT id,status FROM linqasend_wallet_money_operations WHERE id=$1 AND user_id=$2`,[quoteId,userId])).rows[0];if(completed)return completed;
      if(new Date(row.expires_at).getTime()<=Date.now()||(await c.query(`SELECT 1 FROM linqasend_wallet_money_abandoned_quotes WHERE quote_id=$1`,[quoteId])).rowCount)throw new Error('WALLET_QUOTE_EXPIRED_OR_NOT_OWNED');
      const s=moneySnapshot.parse(row.snapshot);
      // Biometric state/principal locks precede user and wallet locks, matching recovery/revocation.
      const principal=await authorize(c,s);
      await c.query(`SELECT id FROM users WHERE id=$1 FOR UPDATE`,[userId]);
      const concurrent=(await c.query(`SELECT id,status FROM linqasend_wallet_money_operations WHERE id=$1 AND user_id=$2`,[quoteId,userId])).rows[0];if(concurrent)return concurrent;
      await c.query(`SELECT id FROM linqasend_wallet_accounts_v2 WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,[[s.walletId,...(s.targetWalletId?[s.targetWalletId]:[])]]);
      const current=await this.context(userId,{walletId:s.walletId,kind:s.kind,amountMinor:s.amountMinor,targetId:s.targetId},c);
      if(current.hash!==s.targetHash)throw new Error('WALLET_DESTINATION_CHANGED');
      await this.policy.authorize(s,c);
      await c.query(`INSERT INTO linqasend_wallet_money_operations(id,user_id,wallet_id,kind,status,snapshot,authorization_context) VALUES($1,$2,$3,$4,'QUEUED',$5,$6)`,[s.id,userId,s.walletId,s.kind,JSON.stringify(s),JSON.stringify(principal??{})]);
      if(s.kind!=='TOPUP')await this.ledger.reserve(c,s.walletId,userId,BigInt(s.totalMinor),s.currency,s.id);
      if(s.kind==='INTERNAL'){
        await this.ledger.post(c,{ref:`money:${s.id}:settled`,kind:'SETTLE',currency:s.currency,operationId:s.id,evidence:s,legs:[{walletId:s.walletId,bucket:'HELD',amount:-BigInt(s.totalMinor)},{walletId:s.targetWalletId!,bucket:'AVAILABLE',amount:BigInt(s.amountMinor)}]});
        await c.query(`UPDATE linqasend_wallet_money_operations SET status='COMPLETED',updated_at=now() WHERE id=$1`,[s.id]);
      }
      return {id:s.id,status:s.kind==='INTERNAL'?'COMPLETED':'QUEUED'};
    });
  }
  async cancel(userId:string,id:string){return this.tx(async c=>{
    const row=(await c.query(`SELECT * FROM linqasend_wallet_money_operations WHERE id=$1 AND user_id=$2 FOR UPDATE`,[id,userId])).rows[0];
    if(!row)throw new Error('WALLET_OPERATION_NOT_FOUND');if(row.status==='CANCELED')return {id,status:'CANCELED'};
    if(row.submitted_at||!['QUEUED','PROCESSING'].includes(row.status))throw new Error('WALLET_OPERATION_ALREADY_DISPATCHED');
    const s=moneySnapshot.parse(row.snapshot);if(s.kind!=='TOPUP')await this.release(c,s);
    await c.query(`UPDATE linqasend_wallet_money_operations SET status='CANCELED',lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[id]);return {id,status:'CANCELED'};
  });}
  private release(c:PoolClient,s:MoneySnapshot){return this.ledger.finish(c,{id:s.id,wallet_id:s.walletId,amount_minor:s.totalMinor,net_deposit_minor:s.amountMinor,receiver_fee_minor:s.feeMinor,currency:s.currency},false);}
  async requestRefund(userId:string,id:string,reasonCode:string){
    const row=(await this.db.query(`UPDATE linqasend_wallet_money_operations SET refund_requested_at=coalesce(refund_requested_at,now()),refund_reason_code=coalesce(refund_reason_code,$3),next_check_at=now() WHERE id=$1 AND user_id=$2 AND kind IN ('WITHDRAW','EXTERNAL') AND status IN ('COMPLETED','PARTIALLY_RETURNED') RETURNING id,status`,[id,userId,reasonCode])).rows[0];
    if(!row)throw new Error('WALLET_REFUND_NOT_ELIGIBLE');return {...row,refundRequested:true};
  }
  async resolvePending(userId:string,id:string){return this.tx(async c=>{
    const quote=await c.query(`SELECT id FROM linqasend_wallet_money_quotes WHERE id=$1 AND user_id=$2 FOR UPDATE`,[id,userId]);
    if(!quote.rowCount)throw new Error('WALLET_QUOTE_NOT_OWNED');
    const operation=(await c.query(`SELECT id,status FROM linqasend_wallet_money_operations WHERE id=$1 AND user_id=$2`,[id,userId])).rows[0];
    if(operation)return operation;
    await c.query(`INSERT INTO linqasend_wallet_money_abandoned_quotes(quote_id) VALUES($1) ON CONFLICT DO NOTHING`,[id]);
    return {id,status:'CANCELED'};
  });}
  async runOnce(){
    if(!this.gateway)throw new Error('WALLET_MONEY_GATEWAY_REQUIRED');
    const token=randomUUID();
    const row=await this.tx(async c=>{
      const r=(await c.query(`SELECT o.*,q.destination_ref FROM linqasend_wallet_money_operations o JOIN linqasend_wallet_money_quotes q ON q.id=o.id
        WHERE o.kind<>'INTERNAL' AND o.status IN ('QUEUED','PROCESSING','RECONCILING','ACTION_REQUIRED','COMPLETED','PARTIALLY_RETURNED') AND o.next_check_at<=now()
        AND (o.lease_expires_at IS NULL OR o.lease_expires_at<now()) ORDER BY o.next_check_at FOR UPDATE OF o SKIP LOCKED LIMIT 1`)).rows[0];
      if(!r)return null;
      await c.query(`UPDATE linqasend_wallet_money_operations SET lease_token=$2,lease_expires_at=now()+interval '60 seconds' WHERE id=$1`,[r.id,token]);return r;
    });
    if(!row)return 0;
    const s=moneySnapshot.parse(row.snapshot),key=`wallet-money:${s.id}`;
    try{
      let result:MoneyOutcome|null;
      if(row.refund_requested_at&&!row.refund_submission_started_at){
        const claimed=await this.db.query(`UPDATE linqasend_wallet_money_operations SET refund_submission_started_at=now() WHERE id=$1 AND lease_token=$2 AND lease_expires_at>now() AND refund_submission_started_at IS NULL RETURNING id`,[s.id,token]);
        if(!claimed.rowCount)return 1;
        result=await this.gateway.requestRefund({operationId:s.id,idempotencyKey:`wallet-money-refund:${s.id}`,reasonCode:row.refund_reason_code});
      }else if(row.submitted_at)result=await this.gateway.lookup(key);
      else{
        if(Date.parse(s.expiresAt)<=Date.now()){
          await this.tx(async c=>{const r=await c.query(`SELECT id FROM linqasend_wallet_money_operations WHERE id=$1 AND lease_token=$2 AND submitted_at IS NULL FOR UPDATE`,[s.id,token]);if(!r.rowCount)return;if(s.kind!=='TOPUP')await this.release(c,s);await c.query(`UPDATE linqasend_wallet_money_operations SET status='FAILED',failure_code='QUOTE_EXPIRED_BEFORE_DISPATCH',lease_token=NULL,lease_expires_at=NULL WHERE id=$1`,[s.id]);});return 1;
        }
        const ctx=await this.context(s.userId,{walletId:s.walletId,kind:s.kind,amountMinor:s.amountMinor,targetId:s.targetId});if(ctx.hash!==s.targetHash)throw new Error('WALLET_DESTINATION_CHANGED');
        await this.policy.authorize(s);
        const ref=await this.policy.resolve(row.destination_ref,s.userId);
        const dispatch=await this.db.query(`UPDATE linqasend_wallet_money_operations SET submitted_at=now(),status='PROCESSING' WHERE id=$1 AND lease_token=$2 AND lease_expires_at>now() AND submitted_at IS NULL RETURNING id`,[s.id,token]);
        if(!dispatch.rowCount)return 1;
        result=await this.gateway.execute({snapshot:s,snapshotHash:moneyHash(s),targetReference:ref,idempotencyKey:key});
      }
      if(result)await this.applyOutcome(s.id,token,result);
      else await this.defer(s.id,token,'PROVIDER_OUTCOME_UNKNOWN');
    }catch{await this.defer(s.id,token,'WALLET_OPERATION_REQUIRES_RECONCILIATION');}
    return 1;
  }
  private async defer(id:string,token:string,code:string){await this.db.query(`UPDATE linqasend_wallet_money_operations SET status=CASE WHEN status IN ('COMPLETED','PARTIALLY_RETURNED') THEN status WHEN submitted_at IS NULL THEN 'QUEUED' ELSE 'RECONCILING' END,failure_code=$3,next_check_at=now()+interval '1 minute',lease_token=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_token=$2`,[id,token,code]);}
  async applyOutcome(id:string,token:string,input:MoneyOutcome){
    const outcome=moneyOutcome.parse(input);
    await this.tx(async c=>{
      const row=(await c.query(`SELECT * FROM linqasend_wallet_money_operations WHERE id=$1 AND lease_token=$2 FOR UPDATE`,[id,token])).rows[0];if(!row)return;
      const s=moneySnapshot.parse(row.snapshot);
      if(outcome.operationId!==id||outcome.snapshotHash!==moneyHash(s)||outcome.providerId!==s.providerId||outcome.providerQuoteId!==s.providerQuoteId||outcome.currency!==s.currency||outcome.amountMinor!==s.amountMinor||row.provider_ref&&row.provider_ref!==outcome.providerRef)throw new Error('WALLET_PROVIDER_EVIDENCE_MISMATCH');
      const prior=(await c.query(`SELECT evidence FROM linqasend_wallet_money_events WHERE operation_id=$1 AND event_id=$2`,[id,outcome.eventId])).rows[0];
      if(prior&&canonical(prior.evidence)!==canonical(outcome))throw new Error('WALLET_PROVIDER_EVENT_REPLAY_MISMATCH');
      if(!prior)await c.query(`INSERT INTO linqasend_wallet_money_events(operation_id,event_id,evidence) VALUES($1,$2,$3)`,[id,outcome.eventId,JSON.stringify(outcome)]);
      const settled=(await c.query(`SELECT id FROM linqasend_wallet_journals WHERE external_ref=$1`,[`money:${id}:settled`])).rowCount;
      let status=row.status;
      if(outcome.status==='SETTLED'&&!settled){
        if(['FAILED','CANCELED','RETURN_REVIEW'].includes(row.status))throw new Error('WALLET_TERMINAL_OUTCOME_CONFLICT');
        await c.query(`SELECT id FROM linqasend_wallet_accounts_v2 WHERE id=$1 FOR UPDATE`,[s.walletId]);
        await this.ledger.post(c,{ref:`money:${id}:settled`,kind:s.kind==='TOPUP'?'RECEIPT':'SETTLE',currency:s.currency,operationId:id,evidence:outcome,legs:s.kind==='TOPUP'
          ?[{walletId:s.walletId,bucket:'AVAILABLE',amount:BigInt(s.receiveAmountMinor)},{bucket:'CUSTODY_CLEARING',amount:-BigInt(s.receiveAmountMinor)}]
          :[{walletId:s.walletId,bucket:'HELD',amount:-BigInt(s.totalMinor)},{bucket:'PAYOUT_CLEARING',amount:BigInt(s.amountMinor)},...(BigInt(s.feeMinor)>0n?[{bucket:'FEE_REVENUE',amount:BigInt(s.feeMinor)}]:[])]});status='COMPLETED';
      }else if(outcome.status==='FAILED'&&!settled){if(s.kind!=='TOPUP')await this.release(c,s);status='FAILED';}
      else if(outcome.status==='RETURNED'){
        if(!settled)throw new Error('WALLET_RETURN_REQUIRES_SETTLED_OPERATION');
        const maximum=BigInt(s.kind==='TOPUP'?s.receiveAmountMinor:s.totalMinor),total=BigInt(outcome.returnedMinor),previous=BigInt(row.returned_minor),fee=BigInt(outcome.returnedFeeMinor),oldFee=BigInt(row.returned_fee_minor);
        if(total<=0n||total<previous||total>maximum||fee<oldFee||fee>BigInt(s.feeMinor)||fee>total||fee-oldFee>total-previous||total-fee>BigInt(s.amountMinor)||(s.kind==='TOPUP'&&fee!==0n))throw new Error('WALLET_RETURN_AMOUNT_INVALID');
        const delta=total-previous;
        if(delta>0n){
          const w=(await c.query(`SELECT * FROM linqasend_wallet_accounts_v2 WHERE id=$1 FOR UPDATE`,[s.walletId])).rows[0];
          if(s.kind==='TOPUP'&&BigInt(w.available_balance_minor)<delta){
            await c.query(`UPDATE linqasend_wallet_accounts_v2 SET status='FROZEN' WHERE id=$1`,[s.walletId]);status='RETURN_REVIEW';
            await c.query(`INSERT INTO linqasend_operational_alerts(severity,alert_type,subject_type,subject_id,details) VALUES('CRITICAL','WALLET_TOPUP_RETURN_SHORTFALL','WALLET_OPERATION',$1,$2)`,[id,JSON.stringify({returnedMinor:total.toString(),unrecoveredMinor:delta.toString()})]);
          }else{
            const feeDelta=fee-oldFee,principalDelta=delta-feeDelta;
            await this.ledger.post(c,{ref:`money:${id}:return:${total}`,kind:'REVERSAL',currency:s.currency,operationId:id,evidence:outcome,legs:[{walletId:s.walletId,bucket:'AVAILABLE',amount:s.kind==='TOPUP'?-delta:delta},...(principalDelta>0n?[{bucket:s.kind==='TOPUP'?'CUSTODY_CLEARING':'PAYOUT_CLEARING',amount:s.kind==='TOPUP'?principalDelta:-principalDelta}]:[]),...(feeDelta>0n?[{bucket:'FEE_REVENUE',amount:-feeDelta}]:[])]});
            await c.query(`UPDATE linqasend_wallet_money_operations SET returned_minor=$2,returned_fee_minor=$3 WHERE id=$1`,[id,total.toString(),fee.toString()]);status=total===maximum?'RETURNED':'PARTIALLY_RETURNED';
          }
        }
      }else if(!settled&&!['FAILED','CANCELED'].includes(row.status))status=outcome.status==='ACTION_REQUIRED'?'ACTION_REQUIRED':'RECONCILING';
      await c.query(`UPDATE linqasend_wallet_money_operations SET status=$2,provider_ref=$3,action_url=$4,failure_code=NULL,next_check_at=now()+interval '5 minutes',lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,[id,status,outcome.providerRef,outcome.status==='ACTION_REQUIRED'?outcome.actionUrl??null:null]);
    });
  }
  async list(userId:string){return {items:(await this.db.query(`SELECT id,kind,status,snapshot,CASE WHEN user_id=$1 THEN action_url ELSE NULL END AS action_url,returned_minor::text,created_at,updated_at,CASE WHEN user_id=$1 THEN 'SENT' ELSE 'RECEIVED' END AS direction FROM linqasend_wallet_money_operations WHERE user_id=$1 OR kind='INTERNAL' AND snapshot->>'targetWalletId' IN (SELECT id::text FROM linqasend_wallet_accounts_v2 WHERE user_id=$1) ORDER BY created_at DESC LIMIT 100`,[userId])).rows};}
}
