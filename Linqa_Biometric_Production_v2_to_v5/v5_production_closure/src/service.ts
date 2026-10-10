import crypto,{randomBytes,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {AttestationVerifier,DeviceTrustAdapter,Principal,Purpose,RiskAdapter,VaultPolicyAdapter} from './contracts';
import {hashResource,signingPayload} from './canonical';
const CHALLENGE_MS=90_000,GRANT_MS=90_000;
const sha=(x:Buffer|string)=>crypto.createHash('sha256').update(x).digest();
export class BiometricAuthorizationService{
 constructor(private db:Pool,private trust:DeviceTrustAdapter,private risk:RiskAdapter,
  private attest:AttestationVerifier,private vaultPolicy:VaultPolicyAdapter,private production=true){}
 private async epoch(c:Pool|PoolClient,userId:string){
  const q=await c.query(`SELECT security_epoch,recovery_in_progress,locked_until FROM biometric_security_state WHERE user_id=$1`,[userId]);
  if(!q.rowCount)return 1;
  if(q.rows[0].recovery_in_progress)throw new Error('RECOVERY_IN_PROGRESS');
  if(q.rows[0].locked_until&&new Date(q.rows[0].locked_until)>new Date())throw new Error('BIOMETRIC_SECURITY_LOCKED');
  return Number(q.rows[0].security_epoch);
 }
 async enroll(x:{principal:Principal;platform:'IOS'|'ANDROID';publicKeySpkiBase64:string;keyAlias:string;attestation:unknown}){
  const t=await this.trust.get(x.principal); if(!t.trusted||t.compromised||t.revoked)throw new Error('DEVICE_NOT_TRUSTED');
  const spki=Buffer.from(x.publicKeySpkiBase64,'base64'); const key=crypto.createPublicKey({key:spki,format:'der',type:'spki'});
  if(key.asymmetricKeyType!=='ec')throw new Error('INVALID_KEY_TYPE');
  const details=(key as any).asymmetricKeyDetails; if(details?.namedCurve&&details.namedCurve!=='prime256v1')throw new Error('INVALID_EC_CURVE');
  const a=await this.attest.verifyEnrollment({platform:x.platform,publicKeySpki:spki,attestation:x.attestation,principal:x.principal});
  if(this.production&&!a.verified)throw new Error(a.reason||'ATTESTATION_REQUIRED');
  const id=randomUUID(),ep=await this.epoch(this.db,x.principal.userId);
  await this.db.query(`INSERT INTO biometric_credentials(id,user_id,installation_id,device_id,platform,algorithm,public_key_spki,key_alias,biometric_class,state,security_epoch,attestation_status,attested_at,attestation_key_id)
   VALUES($1,$2,$3,$4,$5,'P256_SHA256',$6,$7,'STRONG','ACTIVE',$8,$9,CASE WHEN $9='VERIFIED' THEN now() END,$10)`,
   [id,x.principal.userId,x.principal.installationId,x.principal.deviceId,x.platform,spki,x.keyAlias,ep,a.verified?'VERIFIED':'NOT_SUPPORTED',a.keyId??null]);
  return {credentialId:id,attestation:a.verified?'VERIFIED':'NOT_SUPPORTED'};
 }
 async challenge(x:{principal:Principal;purpose:Purpose;resource:unknown;resourceVersion?:number}){
  const t=await this.trust.get(x.principal); if(!t.trusted||t.compromised||t.revoked)throw new Error('DEVICE_NOT_TRUSTED');
  if(x.purpose.startsWith('VAULT_'))await this.vaultPolicy.assertAllowed(x);
  const r=await this.risk.assess(x); if(!r.allow)throw new Error(r.reason||'RISK_DENIED');
  const ep=await this.epoch(this.db,x.principal.userId);
  const cq=await this.db.query(`SELECT id,attestation_status,security_epoch FROM biometric_credentials WHERE user_id=$1 AND installation_id=$2 AND device_id=$3 AND state='ACTIVE' AND revoked_at IS NULL ORDER BY enrolled_at DESC LIMIT 1`,[x.principal.userId,x.principal.installationId,x.principal.deviceId]);
  if(!cq.rowCount)throw new Error('BIOMETRIC_NOT_ENROLLED'); const cred=cq.rows[0];
  if(Number(cred.security_epoch)!==ep)throw new Error('CREDENTIAL_EPOCH_STALE');
  if(this.production&&cred.attestation_status!=='VERIFIED')throw new Error('ATTESTATION_NOT_VERIFIED');
  const raw=randomBytes(32).toString('base64url'),id=randomUUID(),rh=hashResource(x.resource),expires=new Date(Date.now()+CHALLENGE_MS);
  await this.db.query(`INSERT INTO biometric_challenges(id,user_id,installation_id,device_id,credential_id,purpose,resource_hash,resource_version,challenge_hash,expires_at,risk_snapshot,security_epoch,session_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id,x.principal.userId,x.principal.installationId,x.principal.deviceId,cred.id,x.purpose,rh,x.resourceVersion??1,sha(raw),expires,{score:r.score},ep,x.principal.sessionId]);
  return {challengeId:id,challenge:raw,purpose:x.purpose,resourceHashHex:rh.toString('hex'),securityEpoch:ep,expiresAt:expires.toISOString()};
 }
 async verify(x:{principal:Principal;challengeId:string;challenge:string;signatureBase64:string}){
  const c=await this.db.connect(); try{await c.query('BEGIN');
   const q=await c.query(`SELECT ch.*,cr.public_key_spki,cr.algorithm,cr.state credential_state,cr.revoked_at,cr.attestation_status FROM biometric_challenges ch JOIN biometric_credentials cr ON cr.id=ch.credential_id WHERE ch.id=$1 FOR UPDATE`,[x.challengeId]);
   if(!q.rowCount)throw new Error('CHALLENGE_NOT_FOUND');const z=q.rows[0];
   if(z.user_id!==x.principal.userId||z.installation_id!==x.principal.installationId||z.device_id!==x.principal.deviceId||z.session_id!==x.principal.sessionId)throw new Error('CHALLENGE_BINDING_MISMATCH');
   if(z.consumed_at)throw new Error('CHALLENGE_ALREADY_USED'); if(new Date(z.expires_at).getTime()<Date.now())throw new Error('CHALLENGE_EXPIRED');
   if(z.credential_state!=='ACTIVE'||z.revoked_at)throw new Error('CREDENTIAL_REVOKED'); if(z.algorithm!=='P256_SHA256')throw new Error('ALGORITHM_MISMATCH');
   if(this.production&&z.attestation_status!=='VERIFIED')throw new Error('ATTESTATION_NOT_VERIFIED');
   const ep=await this.epoch(c,z.user_id);if(Number(z.security_epoch)!==ep)throw new Error('SECURITY_EPOCH_STALE');
   if(!crypto.timingSafeEqual(Buffer.from(z.challenge_hash),sha(x.challenge)))throw new Error('CHALLENGE_MISMATCH');
   const payload=signingPayload({challengeId:z.id,challenge:x.challenge,purpose:z.purpose,resourceHashHex:Buffer.from(z.resource_hash).toString('hex'),userId:z.user_id,installationId:z.installation_id,deviceId:z.device_id,sessionId:z.session_id,securityEpoch:ep});
   const key=crypto.createPublicKey({key:z.public_key_spki,format:'der',type:'spki'}); if(key.asymmetricKeyType!=='ec')throw new Error('KEY_TYPE_MISMATCH');
   if(!crypto.verify('sha256',payload,key,Buffer.from(x.signatureBase64,'base64')))throw new Error('INVALID_BIOMETRIC_SIGNATURE');
   const grantId=randomUUID(),expires=new Date(Date.now()+GRANT_MS);
   await c.query(`UPDATE biometric_challenges SET consumed_at=now() WHERE id=$1`,[z.id]);
   await c.query(`INSERT INTO biometric_grants(id,user_id,installation_id,device_id,credential_id,purpose,resource_hash,resource_version,expires_at,security_epoch,session_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[grantId,z.user_id,z.installation_id,z.device_id,z.credential_id,z.purpose,z.resource_hash,z.resource_version,expires,ep,z.session_id]);
   await c.query('COMMIT');return {grantId,expiresAt:expires.toISOString()};
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }
 async consume(x:{client:PoolClient;principal:Principal;grantId:string;purpose:Purpose;resource:unknown;resourceVersion?:number}){
  const q=await x.client.query(`SELECT * FROM biometric_grants WHERE id=$1 FOR UPDATE`,[x.grantId]);if(!q.rowCount)throw new Error('GRANT_NOT_FOUND');const g=q.rows[0];
  if(g.user_id!==x.principal.userId||g.installation_id!==x.principal.installationId||g.device_id!==x.principal.deviceId||g.session_id!==x.principal.sessionId)throw new Error('GRANT_BINDING_MISMATCH');
  if(g.purpose!==x.purpose)throw new Error('GRANT_PURPOSE_MISMATCH');if(g.consumed_at)throw new Error('GRANT_ALREADY_USED');if(new Date(g.expires_at).getTime()<Date.now())throw new Error('GRANT_EXPIRED');
  const ep=await this.epoch(x.client,g.user_id);if(Number(g.security_epoch)!==ep)throw new Error('SECURITY_EPOCH_STALE');if(Number(g.resource_version)!==(x.resourceVersion??1))throw new Error('RESOURCE_VERSION_CHANGED');
  if(!crypto.timingSafeEqual(Buffer.from(g.resource_hash),hashResource(x.resource)))throw new Error('GRANT_RESOURCE_CHANGED');
  await x.client.query(`UPDATE biometric_grants SET consumed_at=now() WHERE id=$1`,[g.id]);return true;
 }
}
