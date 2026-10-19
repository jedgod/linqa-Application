import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { WalletLedgerService } from "../services/linqasend/wallet-ledger.service.js";
import { DepositService } from "../services/linqasend/deposit.service.js";
import { SenderFeeRefundService } from "../services/linqasend/sender-fee-refund.service.js";
import type { FundingRefundResult,PayoutProvider } from "../integrations/linqasend/provider.contracts.js";

// Immutable fixtures are permitted only in the disposable DB created by run-wallet-db-tests.mjs.
const suite=process.env.LINQA_WALLET_DISPOSABLE_TEST_DB==="1"?describe:describe.skip;
suite("sender-fee refunds on real PostgreSQL",()=>{
  let pool:pg.Pool,ledger:WalletLedgerService;
  const FEE="500";
  beforeAll(async()=>{
    pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:8});ledger=new WalletLedgerService(pool);
    await pool.query(`INSERT INTO linqasend_financial_entities_v7(id,legal_name,display_name,entity_type,country_code,status,due_diligence_status,operational_status)
      VALUES('custodian-refund','Refund custodian','Refund custodian','BANK','US','ACTIVE','APPROVED','HEALTHY') ON CONFLICT DO NOTHING`);
  });
  // Other tests' rows must never be picked up by these workers.
  beforeEach(async()=>{await pool.query(`UPDATE linqasend_deposit_requests SET refund_available_at=now()+interval '100 years' WHERE sender_fee_refund_status='PENDING_REFUND'`);});
  afterAll(async()=>{await pool?.end();});
  const policy={authorizePayout:async()=>{},resolveDestination:async(ref:string)=>ref};
  const payout:PayoutProvider={name:"refund-test",createPayout:async()=>({status:"COMPLETED",providerRef:"po-1"}),lookup:async()=>null};

  /** A completed standard withdrawal of a transfer whose sender paid a 500 instant fee. */
  async function completedStandard(opts:{funding?:boolean;complete?:boolean}={}){
    const user=randomUUID(),sender=randomUUID(),recipient=randomUUID(),corridor=randomUUID(),quote=randomUUID(),transfer=randomUUID(),method=randomUUID();
    const publicId=`R${transfer.replaceAll("-","")}`,amount="10000";
    await pool.query(`INSERT INTO users(id,external_subject,status) VALUES($1::uuid,$1::text,'ACTIVE'),($2::uuid,$2::text,'ACTIVE')`,[user,sender]);
    await pool.query(`INSERT INTO user_jurisdiction_profiles_v2(user_id,original_registration_country,verified_residence_country,account_country,regulatory_entity_id,regulatory_jurisdiction) VALUES($1,'US','US','US','custodian-refund','US')`,[user]);
    await pool.query(`INSERT INTO linqasend_recipients(id,owner_user_id,recipient_type,linqa_user_id,display_name,country,preferred_currency) VALUES($1,$2,'LINQA_USER',$3,'Receiver','US','USD')`,[recipient,sender,user]);
    await pool.query(`INSERT INTO linqasend_payment_methods(id,user_id,provider,provider_payment_method_ref,type,verification_status) VALUES($1,$2,'refund-test',$3,'BANK_ACCOUNT','VERIFIED')`,[method,user,`vault:${method}`]);
    await pool.query(`INSERT INTO linqasend_corridors(id,source_country,destination_country,source_currency,destination_currency,min_amount_minor,max_amount_minor,base_margin_bps,min_margin_bps,max_margin_bps,provider) VALUES($1,'US','US','USD','USD',1,999999999999999,0,0,0,$2)`,[corridor,`test-${corridor}`]);
    await pool.query(`INSERT INTO linqasend_quotes(id,user_id,recipient_id,corridor_id,send_amount_minor,send_currency,receive_amount_minor,receive_currency,market_reference_rate,provider_execution_rate,customer_rate,margin_bps,expires_at,sender_fee_minor) VALUES($1,$2,$3,$4,$5,'USD',$5,'USD',1,1,1,0,now()+interval '5 minutes',$6)`,[quote,sender,recipient,corridor,amount,FEE]);
    await pool.query(`INSERT INTO linqasend_transfers(id,public_id,user_id,recipient_id,quote_id,status,send_amount_minor,send_currency,receive_amount_minor,receive_currency,customer_rate,margin_bps,provider,idempotency_key) VALUES($1::uuid,$2,$3,$4,$5,'COMPLETED',$6,'USD',$6,'USD',1,0,'refund-test',$1::text)`,[transfer,publicId,sender,recipient,quote,amount]);
    if(opts.funding!==false)await pool.query(`INSERT INTO linqasend_provider_operations(transfer_id,provider_id,operation_type,idempotency_key,request_hash,state,provider_reference) VALUES($1,'refund-test','FUNDING_AUTHORIZATION',$2,$3,'SUCCEEDED','funding-ref-1')`,[transfer,`${transfer}:funding`,"a".repeat(64)]);
    const evidence={userId:user,amountMinor:amount,currency:"USD",regulatoryEntityId:"custodian-refund",jurisdiction:"US",jurisdictionVersion:1};
    const c=await pool.connect();try{await c.query("BEGIN");await ledger.creditReceipt(c,{id:transfer,recipient_id:recipient,receive_amount_minor:amount,receive_currency:"USD"},evidence,`provider:${transfer}`);await c.query("COMMIT");}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
    const deposits=new DepositService(pool,payout,policy);
    const out=await deposits.request({userId:user,publicId,option:"standard",paymentMethodId:method},async()=>{});
    if(opts.complete!==false){
      await pool.query(`UPDATE linqasend_deposit_requests SET release_on='2020-01-01' WHERE id=$1`,[out.depositId]);
      await deposits.releaseDue();
    }
    return {id:out.depositId,transfer,publicId};
  }
  const makeDue=(id:string)=>pool.query(`UPDATE linqasend_deposit_requests SET refund_available_at=now()-interval '1 second' WHERE id=$1`,[id]);
  const row=async(id:string)=>(await pool.query(`SELECT * FROM linqasend_deposit_requests WHERE id=$1`,[id])).rows[0];
  type Calls={refunds:any[];lookups:string[]};
  function gateway(handlers:{refund?:(i:any)=>Promise<FundingRefundResult>;lookup?:(k:string)=>Promise<FundingRefundResult|null>}={}):{calls:Calls;provider:any}{
    const calls:Calls={refunds:[],lookups:[]};
    return {calls,provider:{
      refundFee:async(i:any)=>{calls.refunds.push(i);return handlers.refund?handlers.refund(i):{status:"REFUNDED" as const,providerRef:"refund-1",fundingProviderRef:i.fundingProviderRef,amountMinor:i.amountMinor.toString(),currency:i.currency};},
      lookupRefundByIdempotencyKey:async(k:string)=>{calls.lookups.push(k);return handlers.lookup?handlers.lookup(k):null;}
    }};
  }

  it("records a pending refund when a standard withdrawal is chosen, and refunds only after it completes",async()=>{
    const d=await completedStandard({complete:false});
    expect((await row(d.id)).sender_fee_refund_status).toBe("PENDING_REFUND");
    const g=gateway();await makeDue(d.id);
    expect(await new SenderFeeRefundService(pool,g.provider).runOnce()).toBe(0);
    expect(g.calls.refunds).toHaveLength(0);
  });
  it("refunds the unused fee once to the original funding reference with provider-confirmed evidence",async()=>{
    const d=await completedStandard();const g=gateway();await makeDue(d.id);
    const service=new SenderFeeRefundService(pool,g.provider);
    expect(await service.runOnce()).toBe(1);
    expect(g.calls.refunds).toEqual([{transferId:d.publicId,fundingProviderRef:"funding-ref-1",amountMinor:500n,currency:"USD",idempotencyKey:`deposit-fee-refund:${d.id}`,reasonCode:"INSTANT_FEE_NOT_USED"}]);
    const r=await row(d.id);expect(r).toMatchObject({sender_fee_refund_status:"REFUNDED",refund_provider_ref:"refund-1"});expect(r.refunded_at).not.toBeNull();
    await makeDue(d.id);expect(await service.runOnce()).toBe(0);expect(g.calls.refunds).toHaveLength(1);
  });
  it("submits exactly one refund when workers race",async()=>{
    const d=await completedStandard();const g=gateway();await makeDue(d.id);
    const service=new SenderFeeRefundService(pool,g.provider);
    await Promise.all([service.runOnce(),service.runOnce(),service.runOnce()]);
    expect(g.calls.refunds).toHaveLength(1);expect((await row(d.id)).sender_fee_refund_status).toBe("REFUNDED");
  });
  it("after a lost response only looks up the original key and never submits a second refund",async()=>{
    const d=await completedStandard();const key=`deposit-fee-refund:${d.id}`;
    const g=gateway({refund:async()=>{throw new Error("response lost");},lookup:async k=>k===key?{status:"REFUNDED",providerRef:"already-refunded",fundingProviderRef:"funding-ref-1",amountMinor:"500",currency:"USD"}:null});
    const service=new SenderFeeRefundService(pool,g.provider);await makeDue(d.id);await service.runOnce();
    let r=await row(d.id);expect(r.sender_fee_refund_status).toBe("PENDING_REFUND");expect(r.refund_submission_started_at).not.toBeNull();expect(r.refund_failure_code).toBe("SENDER_FEE_REFUND_OUTCOME_UNKNOWN");
    await makeDue(d.id);await service.runOnce();
    expect(g.calls.refunds).toHaveLength(1);expect(g.calls.lookups).toEqual([key]);
    r=await row(d.id);expect(r).toMatchObject({sender_fee_refund_status:"REFUNDED",refund_provider_ref:"already-refunded"});
  });
  it("keeps waiting, without resubmitting, while the provider reports the refund as pending or has no record",async()=>{
    const d=await completedStandard();let state:FundingRefundResult|null={status:"PENDING",providerRef:"refund-p",fundingProviderRef:"funding-ref-1",amountMinor:"500",currency:"USD"};
    const g=gateway({refund:async()=>state!,lookup:async()=>state});const service=new SenderFeeRefundService(pool,g.provider);
    await makeDue(d.id);await service.runOnce();expect((await row(d.id)).sender_fee_refund_status).toBe("PENDING_REFUND");
    state=null;await makeDue(d.id);await service.runOnce();
    expect((await row(d.id)).sender_fee_refund_status).toBe("PENDING_REFUND");expect((await row(d.id)).refund_failure_code).toBe("SENDER_FEE_REFUND_OUTCOME_UNKNOWN");
    state={status:"REFUNDED",providerRef:"refund-p",fundingProviderRef:"funding-ref-1",amountMinor:"500",currency:"USD"};
    await makeDue(d.id);await service.runOnce();
    expect((await row(d.id)).sender_fee_refund_status).toBe("REFUNDED");expect(g.calls.refunds).toHaveLength(1);
  });
  it("sends a provider-declared failure to review without crediting or retrying",async()=>{
    const d=await completedStandard();
    const g=gateway({refund:async i=>({status:"FAILED",providerRef:"refund-f",fundingProviderRef:i.fundingProviderRef,amountMinor:i.amountMinor.toString(),currency:i.currency})});
    const service=new SenderFeeRefundService(pool,g.provider);await makeDue(d.id);await service.runOnce();
    expect(await row(d.id)).toMatchObject({sender_fee_refund_status:"REFUND_REVIEW",refund_failure_code:"SENDER_FEE_REFUND_REJECTED",refunded_at:null});
    await makeDue(d.id);expect(await service.runOnce()).toBe(0);expect(g.calls.refunds).toHaveLength(1);
  });
  it("never accepts evidence for a different funding reference, amount or currency",async()=>{
    for(const patch of [{fundingProviderRef:"someone-else"},{amountMinor:"600"},{currency:"EUR"}]){
      const d=await completedStandard();
      const g=gateway({refund:async i=>({status:"REFUNDED",providerRef:"refund-x",fundingProviderRef:i.fundingProviderRef,amountMinor:i.amountMinor.toString(),currency:i.currency,...patch})});
      await makeDue(d.id);await new SenderFeeRefundService(pool,g.provider).runOnce();
      const r=await row(d.id);expect(r.sender_fee_refund_status).toBe("PENDING_REFUND");expect(r.refunded_at).toBeNull();expect(r.refund_provider_ref).toBeNull();
    }
  });
  it("sends a missing funding reference to review without calling the provider",async()=>{
    const d=await completedStandard({funding:false});const g=gateway();await makeDue(d.id);
    await new SenderFeeRefundService(pool,g.provider).runOnce();
    expect(g.calls.refunds).toHaveLength(0);expect(await row(d.id)).toMatchObject({sender_fee_refund_status:"REFUND_REVIEW",refund_failure_code:"SENDER_FEE_FUNDING_REFERENCE_MISSING"});
  });
  it("refuses a refund larger than the sender fee that was actually charged",async()=>{
    const d=await completedStandard();const g=gateway();
    await pool.query(`UPDATE linqasend_deposit_requests SET sender_fee_refund_minor=501 WHERE id=$1`,[d.id]);await makeDue(d.id);
    await new SenderFeeRefundService(pool,g.provider).runOnce();
    expect(g.calls.refunds).toHaveLength(0);expect((await row(d.id)).refund_failure_code).toBe("SENDER_FEE_REFUND_AMOUNT_INVALID");
  });
  it("fails closed when the gateway lacks refund support",async()=>{
    await expect(new SenderFeeRefundService(pool,{} as any).runOnce()).rejects.toThrow("SENDER_FEE_REFUND_UNSUPPORTED");
  });
  it("rejects REFUNDED rows that lack provider evidence at the database level",async()=>{
    const d=await completedStandard();
    await expect(pool.query(`UPDATE linqasend_deposit_requests SET sender_fee_refund_status='REFUNDED' WHERE id=$1`,[d.id])).rejects.toThrow(/linqasend_deposit_refund_evidence/);
  });
});
