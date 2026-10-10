import type {Pool} from 'pg';
import type {LiveLinqaBindings} from '../live/live-bindings.js';
export async function assertVaultProductionReady(db:Pool,b:LiveLinqaBindings,env=process.env){
 if(env.NODE_ENV!=='production') return;
 if(env.VAULT_PRODUCTION_ENABLED!=='true') throw new Error('VAULT_PRODUCTION_DISABLED');
 for(const k of ['RELEASE_GIT_SHA','RELEASE_ARTIFACT_DIGEST','VAULT_QUARANTINE_BUCKET','VAULT_CIPHERTEXT_BUCKET'])
   if(!env[k]) throw new Error(`VAULT_ENV_MISSING:${k}`);
 if(env.VAULT_QUARANTINE_BUCKET===env.VAULT_CIPHERTEXT_BUCKET) throw new Error('VAULT_BUCKET_ISOLATION_REQUIRED');
 const cert=await db.query(`SELECT provider_kind FROM vault_provider_certifications
   WHERE status='APPROVED' AND environment='production' AND git_sha=$1 AND artifact_digest=$2
   AND (expires_at IS NULL OR expires_at>now())`,[env.RELEASE_GIT_SHA,env.RELEASE_ARTIFACT_DIGEST]);
 const have=new Set(cert.rows.map(r=>r.provider_kind));
 for(const kind of ['OBJECT_STORE','MALWARE','DLP','MAIL','BILLING'])
   if(!have.has(kind)) throw new Error(`VAULT_PROVIDER_NOT_CERTIFIED:${kind}`);
 const trust=await b.deviceTrust.list('__readiness__','__readiness__').catch(()=>null);
 if(trust===null) throw new Error('VAULT_DEVICE_TRUST_UNHEALTHY');
}
