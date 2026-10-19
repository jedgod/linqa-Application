import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { WalletLedgerService } from "../services/linqasend/wallet-ledger.service.js";
import { DepositService } from "../services/linqasend/deposit.service.js";
import type { PayoutProvider } from "../integrations/linqasend/provider.contracts.js";
import { BiometricAuthorizationService } from "../security/biometrics/service.js";
import { createWithdrawalPolicy } from "../services/linqasend/withdrawal-policy.js";
import type { AppConfig } from "../config.js";
import { AtomicCompletionService } from "../services/linqasend/atomic-completion.service.js";
import { WebhookInboxService } from "../services/linqasend/webhook-inbox.service.js";
import { ProviderCustodyService } from '../services/linqasend/provider-custody.service.js';
import { ProviderPayoutReconciliationService } from '../services/linqasend/provider-payout-reconciliation.service.js';
import { safeDefaultLinqaSendProviders } from '../integrations/linqasend/safe-default.providers.js';
import type { CustodyProvider } from '../integrations/linqasend/provider.contracts.js';

// Immutable fixtures are permitted only in the disposable DB created by run-wallet-db-tests.mjs.
const suite=process.env.LINQA_WALLET_DISPOSABLE_TEST_DB==="1"?describe:describe.skip;
suite("wallet subledger and payout recovery on real PostgreSQL",()=>{
  let pool:pg.Pool,ledger:WalletLedgerService;
  beforeAll(async()=>{
    pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:8});ledger=new WalletLedgerService(pool);
    await pool.query(`INSERT INTO linqasend_financial_entities_v7(id,legal_name,display_name,entity_type,country_code,status,due_diligence_status,operational_status)
      VALUES('custodian-test','Test custodian','Test custodian','BANK','US','ACTIVE','APPROVED','HEALTHY')`);
  });
  beforeEach(async()=>{await pool.query(`UPDATE linqasend_deposit_requests SET available_at=now()+interval '100 years' WHERE status IN ('SCHEDULED','PROCESSING','RECONCILING')`);});
  afterAll(async()=>{await pool?.end();});
  async function tx<T>(work:(c:pg.PoolClient)=>Promise<T>){const c=await pool.connect();try{await c.query("BEGIN");const r=await work(c);await c.query("COMMIT");return r;}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}}
  async function fixture(currency="USD",amount="10000"){
    const user=randomUUID(),sender=randomUUID(),recipient=randomUUID(),corridor=randomUUID(),quote=randomUUID(),transfer=randomUUID(),method=randomUUID();
    const publicId=`W${transfer.replaceAll("-","")}`;
    await pool.query(`INSERT INTO users(id,external_subject,status) VALUES($1::uuid,$1::text,'ACTIVE'),($2::uuid,$2::text,'ACTIVE')`,[user,sender]);
    await pool.query(`INSERT INTO user_jurisdiction_profiles_v2(user_id,original_registration_country,verified_residence_country,account_country,regulatory_entity_id,regulatory_jurisdiction) VALUES($1,'US','US','US','custodian-test','US')`,[user]);
    await pool.query(`INSERT INTO linqasend_recipients(id,owner_user_id,recipient_type,linqa_user_id,display_name,country,preferred_currency) VALUES($1,$2,'LINQA_USER',$3,'Wallet receiver','US',$4)`,[recipient,sender,user,currency]);
    await pool.query(`INSERT INTO linqasend_payment_methods(id,user_id,provider,provider_payment_method_ref,type,verification_status) VALUES($1,$2,'wallet-test',$3,'BANK_ACCOUNT','VERIFIED')`,[method,user,`vault:${method}`]);
    await pool.query(`INSERT INTO linqasend_corridors(id,source_country,destination_country,source_currency,destination_currency,min_amount_minor,max_amount_minor,base_margin_bps,min_margin_bps,max_margin_bps,provider) VALUES($1,'US','US',$2,$2,1,999999999999999,0,0,0,$3)`,[corridor,currency,`test-${corridor}`]);
    await pool.query(`INSERT INTO linqasend_quotes(id,user_id,recipient_id,corridor_id,send_amount_minor,send_currency,receive_amount_minor,receive_currency,market_reference_rate,provider_execution_rate,customer_rate,margin_bps,expires_at) VALUES($1,$2,$3,$4,$5,$6,$5,$6,1,1,1,0,now()+interval '5 minutes')`,[quote,sender,recipient,corridor,amount,currency]);
    await pool.query(`INSERT INTO linqasend_transfers(id,public_id,user_id,recipient_id,quote_id,status,send_amount_minor,send_currency,receive_amount_minor,receive_currency,customer_rate,margin_bps,provider,idempotency_key) VALUES($1::uuid,$2,$3,$4,$5,'COMPLETED',$6,$7,$6,$7,1,0,'wallet-test',$1::text)`,[transfer,publicId,sender,recipient,quote,amount,currency]);
    const t={id:transfer,recipient_id:recipient,receive_amount_minor:amount,receive_currency:currency};
    const evidence={userId:user,amountMinor:amount,currency,regulatoryEntityId:"custodian-test",jurisdiction:"US",jurisdictionVersion:1};
    const credit=()=>tx(c=>ledger.creditReceipt(c,t,evidence,`provider:${transfer}`));
    return {user,transfer,method,publicId,t,evidence,credit};
  }
  const policy={authorizePayout:async()=>{},resolveDestination:async(ref:string)=>ref};
  const allow=async()=>{};
  function provider(overrides:Partial<PayoutProvider>={}):PayoutProvider{return {name:"wallet-test",createPayout:async()=>({status:"COMPLETED",providerRef:"po-1"}),lookup:async()=>null,...overrides};}
  async function balances(user:string){return (await ledger.summary(user)).items[0]!;}

  it("credits a receipt once under concurrent completion replay and preserves exact minor units",async()=>{
    const f=await fixture("JPY","99999999999999");
    await Promise.all(Array.from({length:4},()=>f.credit()));
    expect(await balances(f.user)).toMatchObject({availableMinor:"99999999999999",heldMinor:"0",pendingMinor:"0",balanceVerified:true});
    expect((await pool.query(`SELECT count(*) FROM linqasend_wallet_journals WHERE external_ref=$1`,[`receipt:${f.transfer}`])).rows[0].count).toBe("1");
  });
  it("rejects wrong currency, receiver and custody scope without creating balances",async()=>{
    const f=await fixture();
    for(const patch of [{currency:"JPY"},{userId:randomUUID()},{regulatoryEntityId:"wrong-entity"},{jurisdictionVersion:2}])
      await expect(tx(c=>ledger.creditReceipt(c,f.t,{...f.evidence,...patch},"proof"))).rejects.toThrow(/MISMATCH/);
    expect((await ledger.summary(f.user)).items).toEqual([]);
  });
  it("does not infer a wallet credit from a completed transfer",async()=>{
    const f=await fixture();await expect(new DepositService(pool,provider()).options(f.user,f.publicId)).rejects.toThrow("wallet_receipt_not_verified");
    await expect(new DepositService(pool,provider()).options(randomUUID(),f.publicId)).rejects.toThrow("transfer_not_found");
  });
  it("serializes competing reservations and prevents spending held funds",async()=>{
    const f=await fixture();const id=await f.credit();
    const r=await Promise.allSettled([tx(c=>ledger.reserve(c,id,f.user,8000n,"USD",randomUUID())),tx(c=>ledger.reserve(c,id,f.user,8000n,"USD",randomUUID()))]);
    expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(1);
    expect(await balances(f.user)).toMatchObject({availableMinor:"2000",heldMinor:"8000",postedMinor:"10000"});
  });
  it("rolls back reservation if authorization fails and admits only one withdrawal per receipt",async()=>{
    const f=await fixture();await f.credit();const service=new DepositService(pool,provider(),policy);
    const input={userId:f.user,publicId:f.publicId,option:"instant" as const,paymentMethodId:f.method};
    await expect(service.request(input,async()=>{throw new Error("BIOMETRIC_ALREADY_USED");})).rejects.toThrow("BIOMETRIC_ALREADY_USED");
    expect((await balances(f.user)).availableMinor).toBe("10000");
    const r=await Promise.allSettled([service.request(input,allow),service.request(input,allow)]);
    expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(1);
    expect(await balances(f.user)).toMatchObject({availableMinor:"0",heldMinor:"10000"});
  });
  it("recovers a lost provider response by the original key, without a second payout",async()=>{
    const f=await fixture();await f.credit();let submits=0;const keys:string[]=[];
    const service=new DepositService(pool,provider({createPayout:async i=>{submits++;keys.push(i.idempotencyKey);throw new Error("response lost");},lookupByIdempotencyKey:async key=>{expect(key).toBe(keys[0]);return {status:"COMPLETED",providerRef:"already-paid"};}}),policy);
    const out=await service.request({userId:f.user,publicId:f.publicId,option:"instant",paymentMethodId:f.method},allow);
    await service.releaseDue();
    expect((await pool.query(`SELECT status FROM linqasend_deposit_requests WHERE id=$1`,[out.depositId])).rows[0].status).toBe("RECONCILING");
    expect((await balances(f.user)).heldMinor).toBe("10000");
    await pool.query(`UPDATE linqasend_deposit_requests SET available_at=now()-interval '1 second' WHERE id=$1`,[out.depositId]);
    await service.releaseDue();expect(submits).toBe(1);
    expect(await balances(f.user)).toMatchObject({availableMinor:"0",heldMinor:"0",postedMinor:"0"});
    expect((await pool.query(`SELECT status FROM linqasend_deposit_requests WHERE id=$1`,[out.depositId])).rows[0].status).toBe("COMPLETED");
  });
  it("releases a hold only for definitive rejection and permits a new authorized attempt",async()=>{
    const f=await fixture();await f.credit();const service=new DepositService(pool,provider({createPayout:async()=>({status:"FAILED",providerRef:"rejected"})}),policy);
    const input={userId:f.user,publicId:f.publicId,option:"instant" as const,paymentMethodId:f.method};
    const first=await service.request(input,allow);await service.releaseDue();
    expect(await balances(f.user)).toMatchObject({availableMinor:"10000",heldMinor:"0"});
    const second=await service.request(input,allow);expect(second.depositId).not.toBe(first.depositId);
  });
  it("recovers expired leases without resubmitting an already-dispatched operation",async()=>{
    const f=await fixture();await f.credit();let submits=0,lookups=0;
    const service=new DepositService(pool,provider({createPayout:async()=>{submits++;return {status:"COMPLETED",providerRef:"new"};},lookupByIdempotencyKey:async()=>{lookups++;return null;}}),policy);
    const out=await service.request({userId:f.user,publicId:f.publicId,option:"instant",paymentMethodId:f.method},allow);
    await pool.query(`UPDATE linqasend_deposit_requests SET status='PROCESSING',submission_started_at=now(),lease_token=$2,lease_expires_at=now()-interval '1 minute' WHERE id=$1`,[out.depositId,randomUUID()]);
    await service.releaseDue();expect(submits).toBe(0);expect(lookups).toBe(1);expect((await balances(f.user)).heldMinor).toBe("10000");
  });
  it("keeps standard funds reserved until due and rejects malformed journal history",async()=>{
    const f=await fixture();await f.credit();let submits=0;
    const service=new DepositService(pool,provider({createPayout:async()=>{submits++;return {status:"COMPLETED",providerRef:"std"};}}),policy);
    const out=await service.request({userId:f.user,publicId:f.publicId,option:"standard",paymentMethodId:f.method},allow);
    await service.releaseDue(new Date("2020-01-01"));expect(submits).toBe(0);
    await pool.query(`UPDATE linqasend_deposit_requests SET release_on='2020-01-01' WHERE id=$1`,[out.depositId]);
    await service.releaseDue();expect(submits).toBe(1);
    await expect(pool.query(`UPDATE linqasend_wallet_postings SET amount_minor=1 WHERE wallet_id IN(SELECT id FROM linqasend_wallet_accounts_v2 WHERE user_id=$1)`,[f.user])).rejects.toThrow("WALLET_HISTORY_IS_IMMUTABLE");
    await expect(tx(async c=>{await c.query(`INSERT INTO linqasend_wallet_journals(external_ref,kind,currency) VALUES($1,'RECEIPT','USD')`,[randomUUID()]);})).rejects.toThrow("UNBALANCED_WALLET_JOURNAL");
  });
  it("binds the withdrawal resource to its user, session, device, installation and expiry",async()=>{
    const f=await fixture();await f.credit();const deposits=new DepositService(pool,provider(),policy);
    const {snapshot}=await deposits.preview({userId:f.user,publicId:f.publicId,option:"instant",paymentMethodId:f.method});
    const p={userId:f.user,deviceId:randomUUID(),sessionId:randomUUID(),installationId:randomUUID()};
    const id=(await pool.query(`INSERT INTO linqasend_withdrawal_challenges(user_id,device_id,session_id,installation_id,snapshot) VALUES($1,$2,$3,$4,$5) RETURNING id`,[p.userId,p.deviceId,p.sessionId,p.installationId,JSON.stringify(snapshot)])).rows[0].id;
    const bio=new BiometricAuthorizationService(pool,false);
    expect(await tx(c=>bio.resource(c,p,"SEND_CASHOUT_AUTHORIZE",{itemId:id}))).toEqual(snapshot);
    for(const patch of [{userId:randomUUID()},{deviceId:randomUUID()},{sessionId:randomUUID()},{installationId:randomUUID()}])
      await expect(tx(c=>bio.resource(c,{...p,...patch},"SEND_CASHOUT_AUTHORIZE",{itemId:id}))).rejects.toThrow("BIOMETRIC_WITHDRAWAL_CHALLENGE_INVALID");
    await pool.query(`UPDATE linqasend_withdrawal_challenges SET expires_at=now()-interval '1 second' WHERE id=$1`,[id]);
    await expect(tx(c=>bio.resource(c,p,"SEND_CASHOUT_AUTHORIZE",{itemId:id}))).rejects.toThrow("BIOMETRIC_WITHDRAWAL_CHALLENGE_INVALID");
  });
  it("detects projection drift, freezes spending and isolates account activity",async()=>{
    const f=await fixture();const id=await f.credit();
    expect((await ledger.activity(randomUUID(),id)).items).toEqual([]);
    await pool.query(`UPDATE linqasend_wallet_accounts_v2 SET available_balance_minor=available_balance_minor+1 WHERE id=$1`,[id]);
    expect(await ledger.reconcileProjections()).toBe(1);
    expect((await balances(f.user)).status).toBe("FROZEN");
    await expect(tx(c=>ledger.reserve(c,id,f.user,1n,"USD",randomUUID()))).rejects.toThrow("WALLET_NOT_ACTIVE");
  });
  it("cancels an undispatched withdrawal once, releases the hold, and rejects another owner",async()=>{
    const f=await fixture();await f.credit();const service=new DepositService(pool,provider(),policy);
    const out=await service.request({userId:f.user,publicId:f.publicId,option:"standard",paymentMethodId:f.method},allow);
    await expect(service.cancel(randomUUID(),out.depositId)).rejects.toThrow('withdrawal_not_found');
    expect(await service.cancel(f.user,out.depositId)).toEqual({status:'CANCELED'});
    expect(await service.cancel(f.user,out.depositId)).toEqual({status:'CANCELED'});
    expect(await balances(f.user)).toMatchObject({availableMinor:'10000',heldMinor:'0'});
  });
  it("refuses to cancel a dispatched payout whose outcome is not yet known",async()=>{
    const f=await fixture();await f.credit();const service=new DepositService(pool,provider(),policy);
    const out=await service.request({userId:f.user,publicId:f.publicId,option:"instant",paymentMethodId:f.method},allow);
    await pool.query(`UPDATE linqasend_deposit_requests SET submission_started_at=now(),status='RECONCILING' WHERE id=$1`,[out.depositId]);
    await expect(service.cancel(f.user,out.depositId)).rejects.toThrow('withdrawal_already_dispatched');
    expect((await balances(f.user)).heldMinor).toBe('10000');
  });
  it("rejects adding legs to a committed receipt and rejects a currency-mismatched wallet",async()=>{
    const f=await fixture();const walletId=await f.credit();
    const j=(await pool.query(`SELECT id FROM linqasend_wallet_journals WHERE external_ref=$1`,[`receipt:${f.transfer}`])).rows[0].id;
    await expect(pool.query(`INSERT INTO linqasend_wallet_postings(journal_id,wallet_id,bucket,amount_minor,currency) VALUES($1,$2,'AVAILABLE',1,'USD')`,[j,walletId])).rejects.toThrow('WALLET_JOURNAL_ALREADY_POSTED');
    await expect(tx(c=>ledger.post(c,{ref:randomUUID(),kind:'RECEIPT',currency:'JPY',legs:[{walletId,bucket:'AVAILABLE',amount:1n},{bucket:'CUSTODY_CLEARING',amount:-1n}]}))).rejects.toThrow('WALLET_NOT_READY_OR_CURRENCY_MISMATCH');
  });
  it("keeps production withdrawal policy closed without verified KYC and destination scope",async()=>{
    const f=await fixture();const walletId=await f.credit();
    const policy=createWithdrawalPolicy(pool,{LINQASEND_REAL_MONEY_ENABLED:true} as AppConfig,{} as any);
    await expect(policy.authorizePayout({wallet_id:walletId,receiver_user_id:f.user,payment_method_id:f.method,provider_id:'wallet-test',destination_ref:`vault:${f.method}`,transfer_id:f.transfer,amount_minor:'10000'})).rejects.toThrow('withdrawal_policy_denied');
  });
  it("lets competing workers dispatch a withdrawal only once",async()=>{
    const f=await fixture();await f.credit();let submits=0;
    const service=new DepositService(pool,provider({createPayout:async()=>{submits++;return {status:'COMPLETED',providerRef:'one-payout'};}}),policy);
    await service.request({userId:f.user,publicId:f.publicId,option:'instant',paymentMethodId:f.method},allow);
    await Promise.all([service.releaseDue(),service.releaseDue()]);expect(submits).toBe(1);
    expect(await balances(f.user)).toMatchObject({availableMinor:'0',heldMinor:'0'});
  });
  it("commits completion and custody receipt together and replays webhook completion without double credit",async()=>{
    const f=await fixture();await pool.query(`UPDATE linqasend_transfers SET status='PAYOUT_PROCESSING' WHERE id=$1`,[f.transfer]);
    const completion=new AtomicCompletionService(pool),reference=`provider:${f.transfer}`;
    await Promise.all([completion.complete({transferId:f.transfer,providerReference:reference,walletCredit:f.evidence,source:'EXECUTION_WORKER'}),
      completion.complete({transferId:f.transfer,providerReference:reference,walletCredit:f.evidence,source:'WEBHOOK_WORKER'})]);
    await new WebhookInboxService(pool).process({id:randomUUID(),providerId:'wallet-test',payload:{id:'repeat-completion',type:'payout',transferId:f.publicId,status:'COMPLETED',providerReference:reference,walletCredit:f.evidence}});
    expect(await balances(f.user)).toMatchObject({availableMinor:'10000',heldMinor:'0'});
    expect((await pool.query(`SELECT count(*) FROM linqasend_ledger_transactions WHERE transfer_id=$1`,[f.transfer])).rows[0].count).toBe('1');
    expect((await pool.query(`SELECT count(*) FROM linqasend_wallet_journals WHERE transfer_id=$1`,[f.transfer])).rows[0].count).toBe('1');
    const liabilities=(await pool.query(`SELECT sum(amount_minor)::text AS total FROM linqasend_customer_liabilities_v8 WHERE currency='USD'`)).rows[0].total;
    const projection=(await pool.query(`SELECT sum(p.amount_minor)::text AS total FROM linqasend_wallet_postings p WHERE p.wallet_id IS NOT NULL AND p.currency='USD'`)).rows[0].total;
    expect(liabilities).toBe(projection);
  });
  it("refuses to convert legacy balance columns into opening money",async()=>{
    const f=await fixture();
    await pool.query(`INSERT INTO linqasend_wallet_accounts_v2(user_id,jurisdiction,regulatory_entity_id,currency,jurisdiction_version,ledger_balance_minor,available_balance_minor,withdrawable_balance_minor)
      VALUES($1,'US','custodian-test','USD',1,500,500,500)`,[f.user]);
    await expect(f.credit()).rejects.toThrow('LEGACY_WALLET_RECONCILIATION_REQUIRED');
    expect((await balances(f.user)).balanceVerified).toBe(false);
    expect((await pool.query(`SELECT count(*) FROM linqasend_wallet_journals WHERE transfer_id=$1`,[f.transfer])).rows[0].count).toBe('0');
  });
  it('registers provider-confirmed custody, detects a shortfall and keeps observation history immutable',async()=>{
    const f=await fixture('CAD');const walletId=await f.credit();let amount='15000',snapshot='one',asOf=new Date().toISOString();
    const custody:CustodyProvider={getBalance:async scope=>({...scope,balanceMinor:amount,snapshotId:snapshot,asOf}),lookupReceipt:async()=>null,
      capabilities:async()=>({version:'LINQASEND_WALLET_V1',custodyBalances:true,custodyReceiptLookup:true,payoutLookupByIdempotencyKey:true})};
    const service=new ProviderCustodyService(pool,custody),scope={providerId:'custody-test',regulatoryEntityId:'custodian-test',currency:'CAD',accountReference:'account-cad'};
    const accountId=await service.registerAccount(scope);await service.assertWalletCovered(walletId);
    expect(await service.coverage('custodian-test','CAD')).toMatchObject({status:'COVERED',liabilityMinor:'10000',assetMinor:'15000'});
    amount='8000';snapshot='two';asOf=new Date(Date.now()+1).toISOString();await service.syncAccount(accountId);
    await expect(service.assertWalletCovered(walletId)).rejects.toThrow('CUSTODY_SHORTFALL');
    amount='9999';await expect(service.syncAccount(accountId)).rejects.toThrow('CUSTODY_SNAPSHOT_REPLAY_MISMATCH');
    await expect(pool.query(`UPDATE linqasend_provider_custody_observations SET balance_minor=1 WHERE account_id=$1`,[accountId])).rejects.toThrow('WALLET_HISTORY_IS_IMMUTABLE');
    await service.sweep();expect((await service.coverage('custodian-test','CAD')).status).toBe('SHORTFALL');
  });
  it('aggregates each provider account once per entity and currency and refuses unapproved entities',async()=>{
    const f=await fixture('CHF');await f.credit();
    const custody:CustodyProvider={getBalance:async scope=>({...scope,balanceMinor:'6000',snapshotId:'s',asOf:new Date().toISOString()}),lookupReceipt:async()=>null,
      capabilities:async()=>({version:'LINQASEND_WALLET_V1',custodyBalances:true,custodyReceiptLookup:true,payoutLookupByIdempotencyKey:true})};
    const service=new ProviderCustodyService(pool,custody);
    for(const providerId of ['one','two'])await service.registerAccount({providerId,regulatoryEntityId:'custodian-test',currency:'CHF',accountReference:`account-${providerId}`});
    expect(await service.coverage('custodian-test','CHF')).toMatchObject({status:'COVERED',assetMinor:'12000',liabilityMinor:'10000'});
    await expect(service.registerAccount({providerId:'three',regulatoryEntityId:'not-approved',currency:'CHF',accountReference:'unapproved'})).rejects.toThrow('CUSTODY_ENTITY_NOT_APPROVED');
    expect((await service.coverage('missing-entity','CHF')).status).toBe('UNVERIFIED');
  });
  it('recovers a completed payout with a lost response using explicit gateway custody evidence',async()=>{
    const f=await fixture('AUD'),key=`payout:${f.transfer}`;let submits=0;
    await pool.query(`UPDATE linqasend_transfers SET status='PROCESSING' WHERE id=$1`,[f.transfer]);
    await pool.query(`INSERT INTO linqasend_provider_operations(transfer_id,provider_id,operation_type,idempotency_key,request_hash,state)
      VALUES($1,'wallet-test','PAYOUT',$2,$3,'UNKNOWN')`,[f.transfer,key,'a'.repeat(64)]);
    const providers=safeDefaultLinqaSendProviders();providers.payout=provider({createPayout:async()=>{submits++;throw new Error('must not submit');},lookupByIdempotencyKey:async k=>k===key?{status:'COMPLETED',providerRef:'lookup-paid'}:null});
    providers.custody={getBalance:async()=>{throw new Error('unused');},capabilities:async()=>({version:'LINQASEND_WALLET_V1',custodyBalances:true,custodyReceiptLookup:true,payoutLookupByIdempotencyKey:true}),
      lookupReceipt:async k=>k===key?{status:'SETTLED',providerId:'wallet-test',transferId:f.publicId,providerRef:'lookup-paid',walletCredit:f.evidence}:null};
    await new ProviderPayoutReconciliationService(pool,providers).runOnce();
    expect(submits).toBe(0);expect((await balances(f.user)).availableMinor).toBe('10000');
    expect((await pool.query(`SELECT status FROM linqasend_transfers WHERE id=$1`,[f.transfer])).rows[0].status).toBe('COMPLETED');
  });
  it('does not credit a mismatched provider custody receipt',async()=>{
    const f=await fixture('NZD'),key=`payout:${f.transfer}`;
    await pool.query(`UPDATE linqasend_transfers SET status='PAYOUT_PROCESSING' WHERE id=$1`,[f.transfer]);
    await pool.query(`INSERT INTO linqasend_provider_operations(transfer_id,provider_id,operation_type,idempotency_key,request_hash,state)
      VALUES($1,'wallet-test','PAYOUT',$2,$3,'UNKNOWN')`,[f.transfer,key,'b'.repeat(64)]);
    const providers=safeDefaultLinqaSendProviders();providers.payout=provider({lookupByIdempotencyKey:async k=>k===key?{status:'COMPLETED',providerRef:'paid'}:null});
    providers.custody={getBalance:async()=>{throw new Error('unused');},capabilities:async()=>({version:'LINQASEND_WALLET_V1',custodyBalances:true,custodyReceiptLookup:true,payoutLookupByIdempotencyKey:true}),
      lookupReceipt:async()=>({status:'SETTLED',providerId:'wrong-provider',transferId:f.publicId,providerRef:'paid',walletCredit:f.evidence})};
    await new ProviderPayoutReconciliationService(pool,providers).runOnce();
    expect((await ledger.summary(f.user)).items).toEqual([]);
    expect((await pool.query(`SELECT status FROM linqasend_transfers WHERE id=$1`,[f.transfer])).rows[0].status).toBe('PAYOUT_PROCESSING');
  });
});
