import { readFile,readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { migrate } from '../db/migration-runner.js';

// Explicit, bounded wallet rollout. Refuse to pull unrelated pending migrations into a wallet deployment.
const config=loadConfig(),db=createPool(config),client=await db.connect();
try{
  const directory=fileURLToPath(new URL('../db/migrations/',import.meta.url));
  const files=(await readdir(directory)).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
  const applied=(await client.query(`SELECT version,checksum_sha256,dirty FROM schema_migrations`)).rows;
  const pending:string[]=[];
  for(const file of files){
    const row=applied.find(r=>r.version===file);
    if(!row){pending.push(file);continue;}
    const hash=createHash('sha256').update(await readFile(new URL(`../db/migrations/${file}`,import.meta.url))).digest('hex');
    if(row.dirty||row.checksum_sha256!==hash)throw new Error('EXISTING_MIGRATION_NOT_VERIFIED');
  }
  const allowed=['082_linqasend_wallet_subledger.sql','083_linqasend_provider_custody.sql','084_linqasend_wallet_money.sql','085_linqasend_sender_fee_refunds.sql'];
  if(pending.some(p=>!allowed.includes(p)))throw new Error('UNRELATED_MIGRATIONS_PENDING');
  if(!process.argv.includes('--apply'))console.log(JSON.stringify({mode:'plan',pending},null,2));
  else{
    const privilege=(await client.query(`SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create,
      NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND c.relname IN ('linqasend_wallet_accounts_v2','linqasend_transfers','linqasend_deposit_requests') AND NOT pg_has_role(current_user,c.relowner,'USAGE')) AS can_alter`)).rows[0];
    if(pending.length&&(!privilege.can_create||(pending.includes('082_linqasend_wallet_subledger.sql')&&!privilege.can_alter)))throw new Error('SCHEMA_MIGRATION_ROLE_REQUIRED');
    await migrate(client,directory,'wallet-custody-rollout');
    console.log(JSON.stringify({mode:'applied',migrations:pending},null,2));
  }
}catch(error){console.error(JSON.stringify({error:error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'WALLET_MIGRATION_FAILED'}));process.exitCode=1;}
finally{client.release();await db.end();}
