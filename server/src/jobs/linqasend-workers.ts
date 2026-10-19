import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { configureLinqaSendProviders, getLinqaSendProviders, resetLinqaSendProvidersToSafeDefaults } from "../integrations/linqasend/provider.registry.js";
import { createHttpLinqaSendProviders } from "../integrations/linqasend/http.providers.js";
import { RiskEngineService } from "../services/linqasend/risk-engine.service.js";
import { LedgerService } from "../services/linqasend/ledger.service.js";
import { TransferOrchestratorService } from "../services/linqasend/transfer-orchestrator.service.js";
import { AwsProductionKmsProvider } from "../security/kms/production-kms-provider.js";
import { ProviderTokenVaultService } from "../services/linqasend/provider-token-vault.service.js";
import { DepositService } from "../services/linqasend/deposit.service.js";
import { createWithdrawalPolicy } from "../services/linqasend/withdrawal-policy.js";
import { SenderFeeRefundService } from "../services/linqasend/sender-fee-refund.service.js";
import { WalletMoneyService } from '../services/linqasend/wallet-money.service.js';
import { createWalletMoneyPolicy } from '../services/linqasend/wallet-money-policy.js';
import { LINQASEND_WORKERS,LinqaSendWorkerSupervisor } from "../services/linqasend/worker-supervisor.service.js";

const config=loadConfig();
if(config.LINQASEND_REAL_MONEY_ENABLED!==true)throw new Error("LINQASEND_WORKERS_REQUIRE_EXPLICIT_REAL_MONEY_ENABLEMENT");
if(!config.LINQASEND_PROVIDER_URL||!config.LINQASEND_PROVIDER_TOKEN||!config.LINQASEND_TOKEN_KMS_KEY_ID||!config.LINQASEND_TOKEN_KMS_REGION)throw new Error("LINQASEND_WORKER_PRODUCTION_CONFIGURATION_INCOMPLETE");
const db=createPool(config);resetLinqaSendProvidersToSafeDefaults();configureLinqaSendProviders(createHttpLinqaSendProviders(config.LINQASEND_PROVIDER_URL,config.LINQASEND_PROVIDER_TOKEN));
const providers=getLinqaSendProviders();const vault=new ProviderTokenVaultService(db,new AwsProductionKmsProvider(config.LINQASEND_TOKEN_KMS_KEY_ID,config.LINQASEND_TOKEN_KMS_REGION),config.LINQASEND_TOKEN_KMS_KEY_ID);
// A configured URL is insufficient: do not advertise healthy money workers against an incompatible gateway/schema.
const walletFeatures=await providers.custody!.capabilities();
if(!walletFeatures.custodyBalances||!walletFeatures.custodyReceiptLookup||!walletFeatures.payoutLookupByIdempotencyKey)throw new Error('LINQASEND_GATEWAY_WALLET_CONTRACT_INCOMPLETE');
if(walletFeatures.senderFeeRefunds!==true)throw new Error('LINQASEND_GATEWAY_SENDER_FEE_REFUND_CONTRACT_MISSING');
const walletSchema=await db.query(`SELECT version FROM schema_migrations WHERE version IN ('082_linqasend_wallet_subledger.sql','083_linqasend_provider_custody.sql','084_linqasend_wallet_money.sql','085_linqasend_sender_fee_refunds.sql') AND dirty=false`);
if(walletSchema.rows.length!==4)throw new Error('LINQASEND_WALLET_SCHEMA_NOT_READY');
if(!providers.walletMoney)throw new Error('WALLET_MONEY_GATEWAY_REQUIRED');
const moneyFeatures=await providers.walletMoney.capabilities();
if(!moneyFeatures.amountWithdrawals||!moneyFeatures.settledTopups||!moneyFeatures.externalPayments||!moneyFeatures.returns||!moneyFeatures.refunds||!moneyFeatures.bankLinking)throw new Error('WALLET_MONEY_GATEWAY_CAPABILITY_MISSING');
const orchestrator=new TransferOrchestratorService(db,new RiskEngineService(),new LedgerService(db),providers,vault);const deposits=new DepositService(db,providers.payout,createWithdrawalPolicy(db,config,vault));const money=new WalletMoneyService(db,providers.walletMoney,createWalletMoneyPolicy(db,config,vault));const supervisor=new LinqaSendWorkerSupervisor(db,orchestrator,providers,config.LINQASEND_EXECUTION_LEASE_SECONDS??60,deposits,money,new SenderFeeRefundService(db,providers.funding));const instanceId=randomUUID();
let stopping=false;process.on("SIGTERM",()=>{stopping=true;});process.on("SIGINT",()=>{stopping=true;});
while(!stopping){for(const worker of LINQASEND_WORKERS){try{await supervisor.runOnce(worker,instanceId);}catch(error){console.error(JSON.stringify({worker,error:error instanceof Error?error.message:"unknown"}));}}await new Promise((resolve)=>setTimeout(resolve,1000));}
await db.end();
