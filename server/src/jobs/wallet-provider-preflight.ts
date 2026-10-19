import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { createHttpLinqaSendProviders } from '../integrations/linqasend/http.providers.js';
import { ProviderCustodyService } from '../services/linqasend/provider-custody.service.js';

/** Read-only report: no migrations, account registration, provider payout, or real-money flag changes. */
const config=loadConfig(),db=createPool(config),blockers:string[]=[];
const report:Record<string,unknown>={environment:config.NODE_ENV,mode:config.LINQASEND_MODE,realMoneyEnabled:config.LINQASEND_REAL_MONEY_ENABLED===true,
  gatewayUrlConfigured:!!config.LINQASEND_PROVIDER_URL,gatewayTokenConfigured:!!config.LINQASEND_PROVIDER_TOKEN};
try{
  try{
    const migrations=(await db.query(`SELECT version,checksum_sha256,dirty FROM schema_migrations WHERE version LIKE '082%' OR version LIKE '083%' OR version LIKE '084%' OR version LIKE '085%' ORDER BY version`)).rows;
    report.walletMigrations=migrations.map(m=>({version:m.version,dirty:m.dirty}));
    for(const file of ['082_linqasend_wallet_subledger.sql','083_linqasend_provider_custody.sql','084_linqasend_wallet_money.sql','085_linqasend_sender_fee_refunds.sql']){
      const row=migrations.find(m=>m.version===file);
      const hash=createHash('sha256').update(await readFile(new URL(`../db/migrations/${file}`,import.meta.url))).digest('hex');
      if(!row)blockers.push(`MIGRATION_PENDING:${file}`);else if(row.dirty||row.checksum_sha256!==hash)blockers.push(`MIGRATION_NOT_VERIFIED:${file}`);
    }
    if(migrations.some(m=>m.version==='082_linqasend_wallet_subledger.sql'&&!m.dirty)){
      const receipts=(await db.query(`SELECT count(*)::int AS count FROM linqasend_transfers t JOIN linqasend_recipients r ON r.id=t.recipient_id WHERE t.status='COMPLETED' AND r.recipient_type='LINQA_USER' AND t.wallet_credit_evidence IS NULL`)).rows[0].count;
      const withdrawals=(await db.query(`SELECT count(*)::int AS count FROM linqasend_deposit_requests WHERE wallet_id IS NULL AND status IN ('SCHEDULED','PROCESSING','RECONCILING')`)).rows[0].count;
      report.receiptsAwaitingCustody=receipts;report.legacyWithdrawalsAwaitingReconciliation=withdrawals;
      if(receipts)blockers.push('WALLET_RECEIPTS_AWAITING_PROVIDER_CONFIRMATION');
      if(withdrawals)blockers.push('LEGACY_WITHDRAWALS_RECONCILIATION_REQUIRED');
    }
    if(migrations.some(m=>m.version==='083_linqasend_provider_custody.sql'&&!m.dirty)){
      const count=(await db.query(`SELECT count(*)::int AS count FROM linqasend_provider_custody_accounts WHERE active`)).rows[0].count;
      const scopes=(await db.query(`SELECT regulatory_entity_id,currency FROM linqasend_provider_custody_accounts WHERE active UNION SELECT regulatory_entity_id,currency FROM linqasend_wallet_liabilities_by_entity_v9`)).rows;
      report.activeCustodyAccounts=count;
      if(!count)blockers.push('CUSTODY_ACCOUNTS_NOT_CONFIGURED');
      for(const a of scopes){const r=await new ProviderCustodyService(db).coverage(a.regulatory_entity_id,a.currency.trim());if(r.status!=='COVERED')blockers.push(`CUSTODY_${r.status}`);}
    }
  }catch{blockers.push('DATABASE_PREFLIGHT_UNAVAILABLE');}
  if(!config.LINQASEND_PROVIDER_URL||!config.LINQASEND_PROVIDER_TOKEN)blockers.push('GATEWAY_NOT_CONFIGURED');
  else try{
    const providers=createHttpLinqaSendProviders(config.LINQASEND_PROVIDER_URL,config.LINQASEND_PROVIDER_TOKEN);
    const features=await providers.custody!.capabilities();report.gatewayFeatures=features;
    if(!features.custodyBalances||!features.custodyReceiptLookup||!features.payoutLookupByIdempotencyKey)blockers.push('GATEWAY_WALLET_FEATURES_INCOMPLETE');
    if(features.senderFeeRefunds!==true)blockers.push('GATEWAY_SENDER_FEE_REFUNDS_MISSING');
  }catch{blockers.push('GATEWAY_WALLET_CONTRACT_UNAVAILABLE');}
  if(config.LINQASEND_PROVIDER_URL&&config.LINQASEND_PROVIDER_TOKEN)try{
    const features=await createHttpLinqaSendProviders(config.LINQASEND_PROVIDER_URL,config.LINQASEND_PROVIDER_TOKEN).walletMoney!.capabilities();
    report.walletMoneyFeatures=features;
    if(!features.bankLinking||!features.amountWithdrawals||!features.settledTopups||!features.externalPayments||!features.returns||!features.refunds)blockers.push('WALLET_MONEY_GATEWAY_CAPABILITY_MISSING');
  }catch{blockers.push('WALLET_MONEY_GATEWAY_CONTRACT_UNAVAILABLE');}
  try{if(!(await db.query(`SELECT 1 FROM linqasend_wallet_money_limits WHERE active LIMIT 1`)).rowCount)blockers.push('WALLET_MONEY_LIMITS_NOT_CONFIGURED');}catch{blockers.push('WALLET_MONEY_SCHEMA_UNAVAILABLE');}
  try{report.senderFeeRefunds=(await db.query(`SELECT sender_fee_refund_status AS status,count(*)::int AS count FROM linqasend_deposit_requests WHERE sender_fee_refund_status<>'NONE' GROUP BY 1`)).rows;}catch{}
  if(!config.LINQASEND_TOKEN_KMS_KEY_ID||!config.LINQASEND_TOKEN_KMS_REGION)blockers.push('KMS_NOT_CONFIGURED');
  report.ready=blockers.length===0;report.blockers=blockers;
  console.log(JSON.stringify(report,null,2));if(blockers.length)process.exitCode=1;
}finally{await db.end();}
