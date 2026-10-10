import crypto from 'node:crypto'; import type {Pool} from 'pg';
import type {Principal,AttachmentSourceAdapter,BusinessSourceAdapter,ObjectStore,MalwareScanner,DlpScanner} from '../contracts.js';
const rand=()=>crypto.randomBytes(24).toString('base64url');
export class IntakeService{
 constructor(private db:Pool,private store:ObjectStore,private malware:MalwareScanner,private dlp:DlpScanner,
 private sources:{social:AttachmentSourceAdapter;message:AttachmentSourceAdapter;business:BusinessSourceAdapter}){}
 async import(p:Principal,kind:'social'|'message'|'business',ref:string){
  const src=kind==='business'?await this.sources.business.openAuthorized(p,ref):await this.sources[kind].open(p,ref);
  if(src.size>250*1024*1024) throw new Error('INTAKE_TOO_LARGE');
  const id=crypto.randomUUID(), key=`quarantine/${p.accountId}/${id}/${rand()}`;
  await this.db.query(`INSERT INTO vault_quarantine_objects(id,account_id,user_id,source_kind,source_ref,object_key,expected_size,expected_sha256,mime_declared,state,expires_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'CREATED',now()+interval '2 hours')`,
  [id,p.accountId,p.userId,kind,ref,key,src.size,src.sha256??null,src.mime??null]);
  await this.store.putStream(key,src.stream(),{contentType:src.mime});
  const h=await this.store.head(key);
  if(h.size!==src.size || (src.sha256&&h.sha256&&src.sha256!==h.sha256)){await this.block(id,'INTEGRITY');throw new Error('INTAKE_INTEGRITY_FAILED')}
  await this.db.query(`UPDATE vault_quarantine_objects SET observed_size=$2,observed_sha256=$3,mime_observed=$4,state='VERIFIED',updated_at=now() WHERE id=$1`,
   [id,h.size,h.sha256??null,h.contentType??null]);
  return {importId:id,state:'VERIFIED'};
 }
 async scan(p:Principal,id:string){
  const q=await this.owned(p,id); await this.db.query(`UPDATE vault_quarantine_objects SET state='SCANNING' WHERE id=$1`,[id]);
  const m=await this.malware.scanObject(q.object_key); if(m.verdict!=='CLEAN'){await this.block(id,'MALWARE');return {state:'BLOCKED',reason:'MALWARE'};}
  const d=await this.dlp.scanObject(q.object_key); if(d.verdict!=='ALLOW'){await this.block(id,'DLP');return {state:'BLOCKED',reason:'DLP'};}
  await this.db.query(`UPDATE vault_quarantine_objects SET state='CLEAN',malware_verdict=$2,dlp_verdict=$3,updated_at=now() WHERE id=$1`,[id,m.verdict,d.verdict]);
  return {state:'CLEAN'};
 }
 async handoff(p:Principal,id:string){
  const q=await this.owned(p,id); if(q.state!=='CLEAN')throw new Error('INTAKE_NOT_CLEAN');
  const token=rand(),hash=crypto.createHash('sha256').update(token).digest();
  await this.db.query(`INSERT INTO vault_handoff_grants(quarantine_id,account_id,user_id,device_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes')`,
   [id,p.accountId,p.userId,p.deviceId,hash]);
  return {handoffToken:token,url:await this.store.signedGet(q.object_key,300),expiresIn:300,
   instruction:'CLIENT_MUST_ENCRYPT_BEFORE_VAULT_UPLOAD'};
 }
 private async owned(p:Principal,id:string){const r=await this.db.query(`SELECT * FROM vault_quarantine_objects WHERE id=$1 AND account_id=$2 AND user_id=$3 AND expires_at>now()`,[id,p.accountId,p.userId]);if(!r.rows[0])throw new Error('INTAKE_NOT_FOUND');return r.rows[0]}
 private async block(id:string,why:string){await this.db.query(`UPDATE vault_quarantine_objects SET state='BLOCKED',malware_verdict=CASE WHEN $2='MALWARE' THEN 'BLOCKED' ELSE malware_verdict END,dlp_verdict=CASE WHEN $2='DLP' THEN 'BLOCKED' ELSE dlp_verdict END,updated_at=now() WHERE id=$1`,[id,why])}
}
