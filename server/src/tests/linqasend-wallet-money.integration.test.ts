import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { WalletMoneyService,moneyHash } from '../services/linqasend/wallet-money.service.js';
import { WalletLedgerService } from '../services/linqasend/wallet-ledger.service.js';
import type { MoneySnapshot,MoneyOutcome,WalletMoneyGateway } from '../integrations/linqasend/wallet-money.contracts.js';
import type { WalletMoneyPolicy } from '../services/linqasend/wallet-money-policy.js';
import { BankLinkService } from '../services/linqasend/bank-link.service.js';
import type { ProviderTokenVaultService } from '../services/linqasend/provider-token-vault.service.js';

const suite=process.env.LINQA_WALLET_DISPOSABLE_TEST_DB==='1'?describe:describe.skip;
suite('amount-based wallet money on disposable PostgreSQL',()=>{
  let db:pg.Pool,ledger:WalletLedgerService;
  const allow:WalletMoneyPolicy={authorize:async()=>{},resolve:async r=>r};
  beforeAll(async()=>{db=new pg.Pool({connectionString:process.env.DATABASE_URL,max:12});ledger=new WalletLedgerService(db);
    await db.query(`INSERT INTO linqasend_financial_entities_v7(id,legal_name,display_name,entity_type,country_code,status,due_diligence_status,operational_status) VALUES('money-test','Money test','Money test','BANK','US','ACTIVE','APPROVED','HEALTHY')`);
    await db.query(`INSERT INTO linqasend_provider_custody_accounts(provider_id,regulatory_entity_id,currency,provider_account_ref,active) VALUES('money-provider','money-test','USD','test-account',true)`);
  });
  beforeEach(async()=>{await db.query(`UPDATE linqasend_wallet_money_operations SET next_check_at=now()+interval '100 years'`);});
  afterAll(async()=>{await db?.end();});
  async function tx<T>(fn:(c:pg.PoolClient)=>Promise<T>){const c=await db.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async function fixture(initial='10000'){
    const user=randomUUID(),wallet=randomUUID(),method=randomUUID();
    await db.query(`INSERT INTO users(id,external_subject,status) VALUES($1::uuid,$1::text,'ACTIVE')`,[user]);
    await db.query(`INSERT INTO user_jurisdiction_profiles_v2(user_id,original_registration_country,verified_residence_country,account_country,regulatory_entity_id,regulatory_jurisdiction) VALUES($1,'US','US','US','money-test','US')`,[user]);
    await db.query(`INSERT INTO linqasend_wallet_accounts_v2(id,user_id,jurisdiction,regulatory_entity_id,currency,jurisdiction_version,subledger_enabled) VALUES($1,$2,'US','money-test','USD',1,true)`,[wallet,user]);
    if(BigInt(initial)>0n)await tx(c=>ledger.post(c,{ref:`fixture:${wallet}`,kind:'RECEIPT',currency:'USD',legs:[{walletId:wallet,bucket:'AVAILABLE',amount:BigInt(initial)},{bucket:'CUSTODY_CLEARING',amount:-BigInt(initial)}]}));
    await db.query(`INSERT INTO linqasend_payment_methods(id,user_id,provider,provider_payment_method_ref,type,last4,billing_country,verification_status) VALUES($1,$2,'money-provider',$3,'BANK_ACCOUNT','1234','US','VERIFIED')`,[method,user,`vault:${method}`]);
    await db.query(`INSERT INTO linqasend_verified_bank_capabilities(payment_method_id,user_id,provider_id,country,currency,funding_enabled,payout_enabled,ownership_verified_at,expires_at,evidence_sha256) VALUES($1,$2,'money-provider','US','USD',true,true,now(),now()+interval '1 day',$3)`,[method,user,'a'.repeat(64)]);
    // Wallet service exists only where an active corridor serves the country and currency.
    await db.query(`INSERT INTO linqasend_corridors(source_country,destination_country,source_currency,destination_currency,min_amount_minor,max_amount_minor,base_margin_bps,min_margin_bps,max_margin_bps,provider) VALUES('US','US','USD','USD',100,100000000,0,0,0,'money-provider') ON CONFLICT DO NOTHING`);
    return {user,wallet,method};
  }
  async function balance(user:string){return (await ledger.summary(user)).items[0]!;}
  function gateway(overrides:Partial<WalletMoneyGateway>={}):WalletMoneyGateway{return {
    capabilities:async()=>({version:'LINQASEND_MONEY_V1',bankLinking:true,amountWithdrawals:true,internalLedger:true,settledTopups:true,externalPayments:true,returns:true,refunds:true}),
    quote:async r=>({quoteId:`quote:${r.operationId}`,amountMinor:r.amountMinor,currency:r.currency,feeMinor:'100',totalMinor:(BigInt(r.amountMinor)+100n).toString(),receiveAmountMinor:r.amountMinor,receiveCurrency:r.receiveCurrency,expiresAt:new Date(Date.now()+90_000).toISOString(),estimatedArrival:'Estimate only',fxRate:'1'}),
    execute:async r=>outcome(r.snapshot),lookup:async()=>null,requestRefund:async()=>{throw new Error('unused');},
    beginBankLink:async()=>({providerSessionId:randomUUID(),url:'https://gateway.test/link',expiresAt:new Date(Date.now()+600_000).toISOString()}),bankLinkStatus:async()=>null,...overrides};}
  function outcome(s:MoneySnapshot,extra:Partial<MoneyOutcome>={}):MoneyOutcome{return {operationId:s.id,providerId:s.providerId,providerQuoteId:s.providerQuoteId!,providerRef:`paid:${s.id}`,eventId:`settled:${s.id}`,snapshotHash:moneyHash(s),amountMinor:s.amountMinor,currency:s.currency,returnedMinor:'0',returnedFeeMinor:'0',status:'SETTLED',...extra};}
  async function quote(service:WalletMoneyService,f:Awaited<ReturnType<typeof fixture>>,amount='2500',kind:'WITHDRAW'|'TOPUP'='WITHDRAW'){return service.quote(f.user,{kind,walletId:f.wallet,amountMinor:amount,targetId:f.method});}
  const authorize=async()=>{};
  async function due(id:string){await db.query(`UPDATE linqasend_wallet_money_operations SET next_check_at=now()-interval '1 minute',lease_expires_at=NULL WHERE id=$1`,[id]);}
  async function status(id:string){return (await db.query(`SELECT status FROM linqasend_wallet_money_operations WHERE id=$1`,[id])).rows[0].status;}
  it('withdraws a chosen partial amount and posts the fee exactly once',async()=>{
    const f=await fixture(),service=new WalletMoneyService(db,gateway(),allow),q=await quote(service,f);
    await service.submit(f.user,q.id,authorize);expect(await balance(f.user)).toMatchObject({availableMinor:'7400',heldMinor:'2600'});
    await service.runOnce();expect(await status(q.id)).toBe('COMPLETED');expect(await balance(f.user)).toMatchObject({availableMinor:'7400',heldMinor:'0'});
    expect(await service.submit(f.user,q.id,async()=>{throw new Error('must not reauthorize');})).toMatchObject({id:q.id,status:'COMPLETED'});
    expect((await db.query(`SELECT sum(amount_minor)::text AS n FROM linqasend_wallet_postings WHERE journal_id=(SELECT id FROM linqasend_wallet_journals WHERE external_ref=$1)`,[`money:${q.id}:settled`])).rows[0].n).toBe('0');
  });
  it('serializes competing partial withdrawals without overdrawing',async()=>{
    const f=await fixture(),s=new WalletMoneyService(db,gateway(),allow),a=await quote(s,f,'7000'),b=await quote(s,f,'7000');
    const results=await Promise.allSettled([s.submit(f.user,a.id,authorize),s.submit(f.user,b.id,authorize)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await balance(f.user)).toMatchObject({availableMinor:'2900',heldMinor:'7100'});
  });
  it('rolls back reservation and operation when biometric authorization fails',async()=>{
    const f=await fixture(),s=new WalletMoneyService(db,gateway(),allow),q=await quote(s,f);
    await expect(s.submit(f.user,q.id,async()=>{throw new Error('BIOMETRIC_DENIED');})).rejects.toThrow('BIOMETRIC_DENIED');
    expect(await balance(f.user)).toMatchObject({availableMinor:'10000',heldMinor:'0'});expect((await s.list(f.user)).items).toEqual([]);
  });
  it('reconciles a lost response without submitting a second payout',async()=>{
    const f=await fixture();let calls=0,snapshot:MoneySnapshot;
    const s=new WalletMoneyService(db,gateway({execute:async r=>{calls++;snapshot=r.snapshot;throw new Error('lost');},lookup:async()=>outcome(snapshot)}),allow),q=await quote(s,f);
    await s.submit(f.user,q.id,authorize);await s.runOnce();expect(await status(q.id)).toBe('RECONCILING');expect((await balance(f.user)).heldMinor).toBe('2600');
    await due(q.id);await s.runOnce();expect(calls).toBe(1);expect(await status(q.id)).toBe('COMPLETED');
  });
  it('keeps holds for unknown lookups and rejects cancellation after dispatch',async()=>{
    const f=await fixture(),s=new WalletMoneyService(db,gateway({execute:async()=>{throw new Error('lost');}}),allow),q=await quote(s,f);
    await s.submit(f.user,q.id,authorize);await s.runOnce();await due(q.id);await s.runOnce();
    await expect(s.cancel(f.user,q.id)).rejects.toThrow('WALLET_OPERATION_ALREADY_DISPATCHED');expect((await balance(f.user)).heldMinor).toBe('2600');
  });
  it('cancels a queued amount and releases its hold exactly once',async()=>{
    const f=await fixture(),s=new WalletMoneyService(db,gateway(),allow),q=await quote(s,f);await s.submit(f.user,q.id,authorize);
    await s.cancel(f.user,q.id);await s.cancel(f.user,q.id);expect(await balance(f.user)).toMatchObject({availableMinor:'10000',heldMinor:'0'});
  });
  it('releases a definitively failed payout, but never creates top-up credit on failure',async()=>{
    const f=await fixture(),s=new WalletMoneyService(db,gateway({execute:async r=>outcome(r.snapshot,{status:'FAILED'})}),allow),q=await quote(s,f);
    await s.submit(f.user,q.id,authorize);await s.runOnce();expect((await balance(f.user)).availableMinor).toBe('10000');
    const topup=await quote(s,f,'2000','TOPUP');await s.submit(f.user,topup.id,authorize);await s.runOnce();expect(await status(topup.id)).toBe('FAILED');expect((await balance(f.user)).availableMinor).toBe('10000');
  });
  it('credits top-ups only on settlement and ignores duplicate settlement polls',async()=>{
    const f=await fixture('0');let settled=false;
    const s=new WalletMoneyService(db,gateway({execute:async r=>outcome(r.snapshot,{status:'PROCESSING',eventId:'processing'}),lookup:async()=>settled?outcome(q):outcome(q,{status:'PROCESSING',eventId:'processing'})}),allow),q=await quote(s,f,'5000','TOPUP');
    await s.submit(f.user,q.id,authorize);await s.runOnce();expect((await balance(f.user)).availableMinor).toBe('0');
    settled=true;await due(q.id);await s.runOnce();await due(q.id);await s.runOnce();expect((await balance(f.user)).availableMinor).toBe('5000');
  });
  it('reverses confirmed cumulative returns without double-crediting',async()=>{
    const f=await fixture();let r:MoneyOutcome|null=null;
    const s=new WalletMoneyService(db,gateway({lookup:async()=>r}),allow),q=await quote(s,f);await s.submit(f.user,q.id,authorize);await s.runOnce();
    r=outcome(q,{status:'RETURNED',returnedMinor:'1000',eventId:'return-one'});await due(q.id);await s.runOnce();await due(q.id);await s.runOnce();expect((await balance(f.user)).availableMinor).toBe('8400');
    r=outcome(q,{status:'RETURNED',returnedMinor:'2600',returnedFeeMinor:'100',eventId:'return-two'});await due(q.id);await s.runOnce();expect((await balance(f.user)).availableMinor).toBe('10000');expect(await status(q.id)).toBe('RETURNED');
  });
  it('freezes a spent top-up when a bank return cannot be recovered',async()=>{
    const f=await fixture('0');let returned=false;
    const s=new WalletMoneyService(db,gateway({lookup:async()=>returned?outcome(q,{status:'RETURNED',returnedMinor:'5000',eventId:'bank-return'}):null}),allow),q=await quote(s,f,'5000','TOPUP');
    await s.submit(f.user,q.id,authorize);await s.runOnce();
    await tx(c=>ledger.reserve(c,f.wallet,f.user,4000n,'USD',randomUUID()));
    returned=true;await due(q.id);await s.runOnce();expect(await status(q.id)).toBe('RETURN_REVIEW');expect(await balance(f.user)).toMatchObject({status:'FROZEN',availableMinor:'1000',heldMinor:'4000'});
  });
  it('rejects a mismatched operation proof and preserves the hold',async()=>{
    const f=await fixture(),s=new WalletMoneyService(db,gateway({execute:async r=>outcome(r.snapshot,{snapshotHash:'b'.repeat(64)})}),allow),q=await quote(s,f);
    await s.submit(f.user,q.id,authorize);await s.runOnce();expect(await status(q.id)).toBe('RECONCILING');expect((await balance(f.user)).heldMinor).toBe('2600');
  });
  it('refuses another user’s bank, expired ownership proof and unavailable funding capabilities',async()=>{
    const a=await fixture(),b=await fixture(),s=new WalletMoneyService(db,gateway(),allow);
    await expect(s.quote(a.user,{kind:'WITHDRAW',walletId:a.wallet,amountMinor:'100',targetId:b.method})).rejects.toThrow('VERIFIED_OWNED_BANK_OR_CARD_REQUIRED');
    await db.query(`UPDATE linqasend_verified_bank_capabilities SET funding_enabled=false WHERE payment_method_id=$1`,[a.method]);
    await expect(quote(s,a,'100','TOPUP')).rejects.toThrow('VERIFIED_OWNED_BANK_OR_CARD_REQUIRED');
    await db.query(`UPDATE linqasend_verified_bank_capabilities SET expires_at=now()-interval '1 day' WHERE payment_method_id=$1`,[a.method]);
    await expect(quote(s,a)).rejects.toThrow('VERIFIED_OWNED_BANK_OR_CARD_REQUIRED');
  });
  it('atomically sends wallet balance internally with no external funding call',async()=>{
    const a=await fixture(),b=await fixture('0'),recipient=randomUUID();
    await db.query(`INSERT INTO linqasend_recipients(id,owner_user_id,recipient_type,linqa_user_id,display_name,country,preferred_currency) VALUES($1,$2,'LINQA_USER',$3,'Receiver','US','USD')`,[recipient,a.user,b.user]);
    let calls=0;const s=new WalletMoneyService(db,gateway({execute:async()=>{calls++;throw new Error('must not fund');}}),allow);
    const q=await s.quote(a.user,{kind:'INTERNAL',walletId:a.wallet,amountMinor:'2500',targetId:recipient});
    expect(q).toMatchObject({feeMinor:'250',totalMinor:'2750',amountMinor:'2500',receiveAmountMinor:'2500'});
    await Promise.all([s.submit(a.user,q.id,authorize),s.submit(a.user,q.id,authorize)]);
    // The recipient gets the full amount; the sender pays amount + 10% fee, and the fee posts once to FEE_REVENUE.
    expect((await balance(a.user)).availableMinor).toBe('7250');expect((await balance(b.user)).availableMinor).toBe('2500');expect(calls).toBe(0);
    expect((await db.query(`SELECT sum(amount_minor)::text AS n FROM linqasend_wallet_postings WHERE wallet_id=ANY($1::uuid[])`,[[a.wallet,b.wallet]])).rows[0].n).toBe('9750');
    expect((await db.query(`SELECT sum(amount_minor)::text AS n FROM linqasend_wallet_postings WHERE bucket='FEE_REVENUE' AND journal_id IN (SELECT id FROM linqasend_wallet_journals WHERE operation_id=$1)`,[q.id])).rows[0].n).toBe('250');
  });
  it('does not allow cross-entity internal balance adjustments',async()=>{
    const a=await fixture(),b=await fixture(),recipient=randomUUID();await db.query(`UPDATE linqasend_wallet_accounts_v2 SET regulatory_entity_id='other' WHERE id=$1`,[b.wallet]);
    await db.query(`INSERT INTO linqasend_recipients(id,owner_user_id,recipient_type,linqa_user_id,display_name,country,preferred_currency) VALUES($1,$2,'LINQA_USER',$3,'Receiver','US','USD')`,[recipient,a.user,b.user]);
    await expect(new WalletMoneyService(db,gateway(),allow).quote(a.user,{kind:'INTERNAL',walletId:a.wallet,amountMinor:'1000',targetId:recipient})).rejects.toThrow('RECIPIENT_WALLET_SAME_ENTITY_REQUIRED');
  });
  it('does not register unverified or wrong-owner bank evidence',async()=>{
    const f=await fixture(),g=gateway({bankLinkStatus:async()=>({userId:randomUUID(),type:'BANK_ACCOUNT',providerId:'money-provider',providerReference:'secret',country:'US',currency:'USD',last4:'4321',ownershipVerified:true,fundingEnabled:true,payoutEnabled:true,expiresAt:new Date(Date.now()+600_000).toISOString()})});
    const vault={store:async()=>{throw new Error('must not store');}} as unknown as ProviderTokenVaultService;
    const bank=new BankLinkService(db,g,vault),session=await bank.begin(f.user);
    await expect(bank.confirm(f.user,session.id)).rejects.toThrow('BANK_OWNERSHIP_NOT_VERIFIED');
  });
  it('atomically resolves an unused authorization and prevents any later submission',async()=>{
    const f=await fixture(),s=new WalletMoneyService(db,gateway(),allow),q=await quote(s,f);
    expect(await s.resolvePending(f.user,q.id)).toMatchObject({status:'CANCELED'});
    await expect(s.submit(f.user,q.id,authorize)).rejects.toThrow('WALLET_QUOTE_EXPIRED_OR_NOT_OWNED');expect((await balance(f.user)).availableMinor).toBe('10000');
    const next=await quote(s,f);await s.submit(f.user,next.id,authorize);
    expect(await s.resolvePending(f.user,next.id)).toMatchObject({status:'QUEUED'});expect((await balance(f.user)).heldMinor).toBe('2600');
  });
  it('serializes opposing internal sends without deadlock or changing total liabilities',async()=>{
    const a=await fixture(),b=await fixture(),ar=randomUUID(),br=randomUUID();
    await db.query(`INSERT INTO linqasend_recipients(id,owner_user_id,recipient_type,linqa_user_id,display_name,country,preferred_currency) VALUES($1,$2,'LINQA_USER',$3,'B','US','USD'),($4,$3,'LINQA_USER',$2,'A','US','USD')`,[ar,a.user,b.user,br]);
    const s=new WalletMoneyService(db,gateway(),allow),qa=await s.quote(a.user,{kind:'INTERNAL',walletId:a.wallet,amountMinor:'2000',targetId:ar}),qb=await s.quote(b.user,{kind:'INTERNAL',walletId:b.wallet,amountMinor:'3000',targetId:br});
    await Promise.all([s.submit(a.user,qa.id,authorize),s.submit(b.user,qb.id,authorize)]);
    expect((await balance(a.user)).availableMinor).toBe('10800');expect((await balance(b.user)).availableMinor).toBe('8700');
    expect((await s.list(b.user)).items.some((r:any)=>r.id===qa.id&&r.direction==='RECEIVED')).toBe(true);
  });
  it('executes an explicit external FX quote without inventing a second currency wallet credit',async()=>{
    const f=await fixture(),external=randomUUID(),recipient=randomUUID(),reference=`vault:${randomUUID()}`;
    await db.query(`INSERT INTO linqasend_external_recipients_v1(id,owner_user_id,recipient_kind,display_name,country_code,currency,verification_status) VALUES($1,$2,'EXTERNAL_PERSON','External','GB','GBP','VERIFIED')`,[external,f.user]);
    await db.query(`INSERT INTO linqasend_payout_endpoints_v1(external_recipient_id,delivery_method,provider,provider_token,masked_display,country_code,currency,status,verified_at) VALUES($1,'BANK','money-provider',$2,'Account ending 9999','GB','GBP','ACTIVE',now())`,[external,reference]);
    await db.query(`INSERT INTO linqasend_recipients(id,owner_user_id,recipient_type,external_recipient_id,display_name,country,preferred_currency,payout_profile_ref,payout_provider) VALUES($1,$2,'BANK',$3,'External','GB','GBP',$4,'money-provider')`,[recipient,f.user,external,reference]);
    let sent:any;const g=gateway({execute:async r=>{sent=r;return outcome(r.snapshot);}}),s=new WalletMoneyService(db,{...g,quote:async input=>({...await g.quote(input),receiveAmountMinor:'3900',fxRate:'0.78'})},allow),q=await s.quote(f.user,{kind:'EXTERNAL',walletId:f.wallet,amountMinor:'5000',targetId:recipient});
    await s.submit(f.user,q.id,authorize);await s.runOnce();expect(await status(q.id)).toBe('COMPLETED');expect((await balance(f.user)).availableMinor).toBe('4200');
    expect(q).toMatchObject({feeMinor:'800',totalMinor:'5800'}); // 15.99% of 5000 (799.5, half up) exceeds the provider's 100
    // The rail is told to pay the base amount (in the recipient's currency) and nothing of the retained fee.
    expect(sent.payout).toEqual({sourceAmountMinor:'5000',sourceCurrency:'USD',recipientAmountMinor:'3900',recipientCurrency:'GBP',platformFeeMinor:'800',platformFeeRetained:true});
    expect((await db.query(`SELECT count(*)::int AS n FROM linqasend_wallet_journals WHERE operation_id=$1 AND currency='GBP'`,[q.id])).rows[0].n).toBe(0);
  });
  it('durably requests one refund and reconciles a lost refund response without resubmitting',async()=>{
    const f=await fixture();let refunds=0,requested=false;
    const s=new WalletMoneyService(db,gateway({requestRefund:async()=>{refunds++;requested=true;throw new Error('response lost');},lookup:async()=>requested?outcome(q,{eventId:'refund-confirmed',status:'RETURNED',returnedMinor:'2600',returnedFeeMinor:'100'}):null}),allow),q=await quote(s,f);
    await s.submit(f.user,q.id,authorize);await s.runOnce();await s.requestRefund(f.user,q.id,'OTHER');await s.runOnce();expect((await balance(f.user)).availableMinor).toBe('7400');
    await due(q.id);await s.runOnce();expect(refunds).toBe(1);expect(await status(q.id)).toBe('RETURNED');expect((await balance(f.user)).availableMinor).toBe('10000');
    expect((await db.query(`SELECT sum(amount_minor)::text AS n FROM linqasend_wallet_postings WHERE bucket='FEE_REVENUE' AND journal_id IN (SELECT id FROM linqasend_wallet_journals WHERE operation_id=$1)`,[q.id])).rows[0].n).toBe('0');
  });
  it('completes hosted bank ownership verification once and stores its capabilities',async()=>{
    const f=await fixture(),manifest=randomUUID(),sha='a'.repeat(40);
    await db.query(`INSERT INTO linqasend_evidence_manifests_v6(id,subject_type,subject_id,git_sha,artifact_digest,items,manifest_hash,created_by) VALUES($1,'PROVIDER','money-provider',$2,'test','[]',$3,'test')`,[manifest,sha,moneyHash(manifest)]);
    await db.query(`INSERT INTO linqasend_provider_certifications_v6(id,provider_id,adapter_version,git_sha,evidence_manifest_id,status,certified_by,certified_at,expires_at) VALUES($1,'money-provider','v1',$2,$3,'CERTIFIED','test',now(),now()+interval '1 day')`,[randomUUID(),sha,manifest]);
    const g=gateway({bankLinkStatus:async()=>({userId:f.user,type:'BANK_ACCOUNT',providerId:'money-provider',providerReference:'gateway-approved-account',country:'US',currency:'USD',last4:'4321',ownershipVerified:true,fundingEnabled:true,payoutEnabled:true,expiresAt:new Date(Date.now()+600_000).toISOString()})});
    let stores=0;const vault={store:async()=>{stores++;return `vault:${randomUUID()}`;}} as unknown as ProviderTokenVaultService;
    const bank=new BankLinkService(db,g,vault),session=await bank.begin(f.user),result=await bank.confirm(f.user,session.id);
    expect(await bank.confirm(f.user,session.id)).toEqual(result);expect(stores).toBe(1);
    expect((await db.query(`SELECT funding_enabled,payout_enabled FROM linqasend_verified_bank_capabilities WHERE payment_method_id=$1`,[result.paymentMethodId])).rows[0]).toEqual({funding_enabled:true,payout_enabled:true});
  });
  it('pages wallet activity with a stable cursor, and only shows an operation to its participants',async()=>{
    const f=await fixture(),s=new WalletMoneyService(db,gateway(),allow),ids:string[]=[];
    for(let i=0;i<3;i++){const q=await quote(s,f,'100');await s.submit(f.user,q.id,authorize);ids.push(q.id);}
    const seen:string[]=[];let cursor:string|null=null;
    do{const page=await s.list(f.user,{limit:2,cursor});expect(page.items.length).toBeLessThanOrEqual(2);seen.push(...page.items.map((r:any)=>r.id));cursor=page.nextCursor;}while(cursor);
    expect(seen).toHaveLength(3);expect(new Set(seen).size).toBe(3);expect([...seen].sort()).toEqual([...ids].sort());
    await expect(s.get(f.user,ids[0]!)).resolves.toMatchObject({id:ids[0],direction:'SENT'});
    await expect(s.get(randomUUID(),ids[0]!)).rejects.toThrow('WALLET_OPERATION_NOT_FOUND');
    await expect(s.list(f.user,{cursor:'not-a-cursor!'})).rejects.toThrow('WALLET_CURSOR_INVALID');
  });
  it('opens wallets and moves money only where an active corridor serves the country and currency',async()=>{
    const f=await fixture(),s=new WalletMoneyService(db,gateway(),allow);
    await expect(s.open(f.user,'EUR')).rejects.toThrow('WALLET_CURRENCY_NOT_AVAILABLE');
    await expect(s.open(f.user,'USD')).resolves.toMatchObject({currency:'USD'});
    const served=()=>db.query(`UPDATE linqasend_corridors SET active=$1 WHERE source_country='US' AND source_currency='USD'`,[true]);
    await db.query(`UPDATE linqasend_corridors SET active=false WHERE source_country='US' AND destination_country='US'`);
    try{await expect(quote(s,f)).rejects.toThrow('WALLET_CURRENCY_NOT_AVAILABLE');}finally{await served();}
    expect((await quote(s,f)).currency).toBe('USD');
  });
  it('keeps quotes and provider events immutable',async()=>{
    const f=await fixture(),s=new WalletMoneyService(db,gateway(),allow),q=await quote(s,f);await s.submit(f.user,q.id,authorize);await s.runOnce();
    await expect(db.query(`UPDATE linqasend_wallet_money_quotes SET snapshot='{}' WHERE id=$1`,[q.id])).rejects.toThrow('WALLET_HISTORY_IS_IMMUTABLE');
    await expect(db.query(`DELETE FROM linqasend_wallet_money_events WHERE operation_id=$1`,[q.id])).rejects.toThrow('WALLET_HISTORY_IS_IMMUTABLE');
  });
});
