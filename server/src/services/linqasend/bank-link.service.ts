import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/pool.js';
import type { WalletMoneyGateway } from '../../integrations/linqasend/wallet-money.contracts.js';
import type { ProviderTokenVaultService } from './provider-token-vault.service.js';
import { moneyHash } from './wallet-money.service.js';

/** Hosted ownership verification; client supplied references cannot mark an account verified. */
export class BankLinkService {
  constructor(private db:Database,private gateway?:WalletMoneyGateway,private vault?:ProviderTokenVaultService){}
  async begin(userId:string,type:'BANK_ACCOUNT'|'DEBIT_CARD'='BANK_ACCOUNT'){
    if(!this.gateway||!this.vault)throw new Error('BANK_LINK_PROVIDER_NOT_CONFIGURED');
    if(!(await this.gateway.capabilities()).bankLinking)throw new Error('BANK_LINK_PROVIDER_UNSUPPORTED');
    const id=randomUUID(),r=await this.gateway.beginBankLink({userId,sessionId:id,type});
    if(Date.parse(r.expiresAt)<=Date.now()||Date.parse(r.expiresAt)>Date.now()+30*60_000)throw new Error('BANK_LINK_SESSION_EXPIRY_INVALID');
    await this.db.query(`INSERT INTO linqasend_bank_link_sessions(id,user_id,provider_session_id,expires_at,method_type) VALUES($1,$2,$3,$4,$5)`,[id,userId,r.providerSessionId,r.expiresAt,type]);
    return {id,url:r.url,expiresAt:r.expiresAt};
  }
  async confirm(userId:string,id:string){
    if(!this.gateway||!this.vault)throw new Error('BANK_LINK_PROVIDER_NOT_CONFIGURED');
    const session=(await this.db.query(`SELECT * FROM linqasend_bank_link_sessions WHERE id=$1 AND user_id=$2`,[id,userId])).rows[0];
    if(!session)throw new Error('BANK_LINK_SESSION_NOT_FOUND');
    if(session.consumed_at)return {paymentMethodId:session.payment_method_id};
    if(new Date(session.expires_at).getTime()<=Date.now())throw new Error('BANK_LINK_SESSION_EXPIRED');
    const r=await this.gateway.bankLinkStatus(session.provider_session_id);
    if(!r)throw new Error('BANK_LINK_VERIFICATION_PENDING');
    if(r.userId!==userId||r.type!==session.method_type||!r.ownershipVerified||!r.fundingEnabled&&!r.payoutEnabled||Date.parse(r.expiresAt)<=Date.now())throw new Error('BANK_OWNERSHIP_NOT_VERIFIED');
    const certified=await this.db.query(`SELECT 1 FROM linqasend_provider_certifications_v6 WHERE provider_id=$1 AND status='CERTIFIED' AND expires_at>now()`,[r.providerId]);
    if(!certified.rowCount)throw new Error('BANK_LINK_PROVIDER_NOT_CERTIFIED');
    const ref=await this.vault.store({ownerUserId:userId,providerId:r.providerId,secretKind:'PAYMENT_METHOD',plaintext:r.providerReference,maskedDisplay:`Bank ending ${r.last4}`});
    const c=await this.db.connect();
    try{
      await c.query('BEGIN');
      const current=(await c.query(`SELECT * FROM linqasend_bank_link_sessions WHERE id=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE`,[id,userId])).rows[0];
      if(!current)throw new Error('BANK_LINK_SESSION_EXPIRED');
      if(current.consumed_at){await c.query('COMMIT');return {paymentMethodId:current.payment_method_id};}
      const method=randomUUID();
      await c.query(`INSERT INTO linqasend_payment_methods(id,user_id,provider,provider_payment_method_ref,type,last4,billing_country,verification_status) VALUES($1,$2,$3,$4,$7,$5,$6,'VERIFIED')`,[method,userId,r.providerId,ref,r.last4,r.country,r.type]);
      await c.query(`INSERT INTO linqasend_verified_bank_capabilities(payment_method_id,user_id,provider_id,country,currency,funding_enabled,payout_enabled,ownership_verified_at,expires_at,evidence_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8,$9)`,[method,userId,r.providerId,r.country,r.currency,r.fundingEnabled,r.payoutEnabled,r.expiresAt,moneyHash(r)]);
      await c.query(`UPDATE linqasend_bank_link_sessions SET consumed_at=now(),payment_method_id=$2 WHERE id=$1`,[id,method]);
      await c.query('COMMIT');return {paymentMethodId:method};
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
}
