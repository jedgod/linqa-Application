import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { createHttpLinqaSendProviders } from '../integrations/linqasend/http.providers.js';
import { ProviderCustodyService } from '../services/linqasend/provider-custody.service.js';

const config=loadConfig(),db=createPool(config);
try{
  if(!config.LINQASEND_PROVIDER_URL||!config.LINQASEND_PROVIDER_TOKEN)throw new Error('GATEWAY_NOT_CONFIGURED');
  // Deployment-injected path keeps approved account references outside source control.
  // An explicit CLI path takes precedence; missing input must fail, never silently skip.
  const path=process.argv[2]||process.env.LINQASEND_CUSTODY_MANIFEST_PATH;
  if(!path?.trim())throw new Error('CUSTODY_MANIFEST_PATH_REQUIRED');
  const manifest=z.object({accounts:z.array(z.object({providerId:z.string().min(1),regulatoryEntityId:z.string().min(1),currency:z.string().regex(/^[A-Z]{3}$/),accountReference:z.string().min(1)}).strict()).min(1)}).strict().parse(JSON.parse(await readFile(path,'utf8')));
  const gateway=createHttpLinqaSendProviders(config.LINQASEND_PROVIDER_URL,config.LINQASEND_PROVIDER_TOKEN),features=await gateway.custody!.capabilities();
  if(!features.custodyBalances||!features.custodyReceiptLookup||!features.payoutLookupByIdempotencyKey)throw new Error('GATEWAY_WALLET_FEATURES_INCOMPLETE');
  const custody=new ProviderCustodyService(db,gateway.custody);
  for(const account of manifest.accounts)await custody.registerAccount(account);
  await custody.sweep();console.log(JSON.stringify({registeredAccounts:manifest.accounts.length}));
}catch(error){console.error(JSON.stringify({error:error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'CUSTODY_REGISTRATION_FAILED'}));process.exitCode=1;}
finally{await db.end();}
