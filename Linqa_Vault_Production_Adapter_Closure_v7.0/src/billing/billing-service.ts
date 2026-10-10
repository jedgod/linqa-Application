import crypto from 'node:crypto'; import type {Pool} from 'pg'; import type {BillingAdapter,Principal} from '../contracts.js';
export class BillingService{
 constructor(private db:Pool,private provider:BillingAdapter){}
 async checkout(p:Principal,planCode:string,successUrl:string,cancelUrl:string){
  const allowed=new Set(['VAULT_25','VAULT_40','VAULT_60','VAULT_1TB']); if(!allowed.has(planCode))throw new Error('PLAN_NOT_PURCHASABLE');
  return this.provider.createCheckout({accountId:p.accountId,userId:p.userId,planCode,successUrl,cancelUrl});
 }
 async webhook(raw:Buffer,headers:Record<string,string|undefined>){
  const e=await this.provider.verifyWebhook(raw,headers),sha=crypto.createHash('sha256').update(raw).digest('hex');
  const c=await this.db.connect(); try{await c.query('BEGIN');
   const ins=await c.query(`INSERT INTO vault_billing_events(provider,provider_event_id,raw_sha256,verified,state) VALUES('billing',$1,$2,true,'RECEIVED') ON CONFLICT DO NOTHING RETURNING provider_event_id`,[e.eventId,sha]);
   if(!ins.rowCount){await c.query('ROLLBACK');return {duplicate:true};}
   // Provider-specific payload normalization belongs in adapter; entitlement changes must be server-authoritative.
   await c.query(`UPDATE vault_billing_events SET state='PROCESSED',processed_at=now() WHERE provider='billing' AND provider_event_id=$1`,[e.eventId]);
   await c.query('COMMIT'); return {ok:true};
  }catch(x){await c.query('ROLLBACK');throw x}finally{c.release()}
 }
}
