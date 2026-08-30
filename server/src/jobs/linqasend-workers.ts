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
import { LINQASEND_WORKERS,LinqaSendWorkerSupervisor } from "../services/linqasend/worker-supervisor.service.js";

const config=loadConfig();
if(config.LINQASEND_REAL_MONEY_ENABLED!==true)throw new Error("LINQASEND_WORKERS_REQUIRE_EXPLICIT_REAL_MONEY_ENABLEMENT");
if(!config.LINQASEND_PROVIDER_URL||!config.LINQASEND_PROVIDER_TOKEN||!config.LINQASEND_TOKEN_KMS_KEY_ID||!config.LINQASEND_TOKEN_KMS_REGION)throw new Error("LINQASEND_WORKER_PRODUCTION_CONFIGURATION_INCOMPLETE");
const db=createPool(config);resetLinqaSendProvidersToSafeDefaults();configureLinqaSendProviders(createHttpLinqaSendProviders(config.LINQASEND_PROVIDER_URL,config.LINQASEND_PROVIDER_TOKEN));
const providers=getLinqaSendProviders();const vault=new ProviderTokenVaultService(db,new AwsProductionKmsProvider(config.LINQASEND_TOKEN_KMS_KEY_ID,config.LINQASEND_TOKEN_KMS_REGION),config.LINQASEND_TOKEN_KMS_KEY_ID);
const orchestrator=new TransferOrchestratorService(db,new RiskEngineService(),new LedgerService(db),providers,vault);const supervisor=new LinqaSendWorkerSupervisor(db,orchestrator,providers,config.LINQASEND_EXECUTION_LEASE_SECONDS??60);const instanceId=randomUUID();
let stopping=false;process.on("SIGTERM",()=>{stopping=true;});process.on("SIGINT",()=>{stopping=true;});
while(!stopping){for(const worker of LINQASEND_WORKERS){try{await supervisor.runOnce(worker,instanceId);}catch(error){console.error(JSON.stringify({worker,error:error instanceof Error?error.message:"unknown"}));}}await new Promise((resolve)=>setTimeout(resolve,1000));}
await db.end();
