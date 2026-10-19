import type { FastifyInstance,FastifyRequest,FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/pool.js';
import type { AppConfig } from '../../config.js';
import type { LinqaSendProviders } from '../../integrations/linqasend/provider.contracts.js';
import { moneyRequest,moneySnapshot,walletMoneyKind } from '../../integrations/linqasend/wallet-money.contracts.js';
import { createPaymentAuthenticator } from '../../auth/payment-authenticator.js';
import { requireScope } from '../../auth/jwt.js';
import { InactivePrincipalError } from '../../auth/active-principal.js';
import { biometricPrincipal } from '../biometrics.js';
import type { BiometricAuthorizationService } from '../../security/biometrics/service.js';
import { canonical } from '../../security/biometrics/canonical.js';
import { WalletMoneyService } from '../../services/linqasend/wallet-money.service.js';
import { createWalletMoneyPolicy } from '../../services/linqasend/wallet-money-policy.js';
import { ProviderTokenVaultService } from '../../services/linqasend/provider-token-vault.service.js';
import { AwsProductionKmsProvider } from '../../security/kms/production-kms-provider.js';
import { BankLinkService } from '../../services/linqasend/bank-link.service.js';

export async function registerWalletMoneyRoutes(app:FastifyInstance,config:AppConfig,db:Database,providers:LinqaSendProviders,bio?:BiometricAuthorizationService){
  const auth=createPaymentAuthenticator(config,db);
  const vault=config.LINQASEND_TOKEN_KMS_KEY_ID&&config.LINQASEND_TOKEN_KMS_REGION?new ProviderTokenVaultService(db,new AwsProductionKmsProvider(config.LINQASEND_TOKEN_KMS_KEY_ID,config.LINQASEND_TOKEN_KMS_REGION),config.LINQASEND_TOKEN_KMS_KEY_ID):undefined;
  const money=new WalletMoneyService(db,providers.walletMoney,createWalletMoneyPolicy(db,config,vault)),bank=new BankLinkService(db,providers.walletMoney,vault);
  const wrap=(fn:(r:FastifyRequest,p:FastifyReply)=>Promise<unknown>)=>async(r:FastifyRequest,p:FastifyReply)=>{try{return await fn(r,p);}catch(e){
    if(e instanceof InactivePrincipalError)return p.code(401).send({error:'authentication_revoked'});
    if(e instanceof z.ZodError)return p.code(422).send({error:'validation_error'});
    r.log.warn({code:e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'WALLET_REQUEST_DENIED'},'wallet operation denied');
    return p.code(409).send({error:e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'WALLET_REQUEST_DENIED'});
  }};
  const id=(r:FastifyRequest)=>z.object({id:z.string().uuid()}).parse(r.params).id;
  const rate={config:{rateLimit:{max:20,timeWindow:'1 minute'}}};
  app.post('/v1/linqasend/wallets/open',rate,wrap(async r=>{const p=await auth(r);requireScope(p,'linqasend:write');return money.open(p.userId,z.object({currency:z.string().regex(/^[A-Z]{3}$/)}).strict().parse(r.body).currency);}));
  app.post('/v1/linqasend/bank-links',rate,wrap(async r=>{const p=await auth(r);requireScope(p,'linqasend:write');const input=z.object({type:z.enum(['BANK_ACCOUNT','DEBIT_CARD']).default('BANK_ACCOUNT')}).strict().parse(r.body);return bank.begin(p.userId,input.type);}));
  app.post('/v1/linqasend/bank-links/:id/confirm',rate,wrap(async r=>{const p=await auth(r);requireScope(p,'linqasend:write');return bank.confirm(p.userId,id(r));}));
  app.get('/v1/linqasend/wallet-money/targets',wrap(async r=>{
    const p=await auth(r);requireScope(p,'linqasend:read');
    const {kind}=z.object({kind:walletMoneyKind}).parse(r.query);
    if(kind==='TOPUP'||kind==='WITHDRAW')return {items:(await db.query(`SELECT m.id,m.type,('Account ending '||m.last4) AS name,b.currency,b.country FROM linqasend_payment_methods m JOIN linqasend_verified_bank_capabilities b ON b.payment_method_id=m.id AND b.user_id=m.user_id WHERE m.user_id=$1 AND m.deleted_at IS NULL AND m.verification_status='VERIFIED' AND b.expires_at>now() AND CASE WHEN $2='TOPUP' THEN b.funding_enabled ELSE b.payout_enabled END ORDER BY m.created_at DESC`,[p.userId,kind])).rows};
    return {items:(await db.query(`SELECT id,recipient_type AS type,display_name AS name,preferred_currency AS currency,country FROM linqasend_recipients WHERE owner_user_id=$1 AND CASE WHEN $2='INTERNAL' THEN recipient_type='LINQA_USER' ELSE recipient_type::text IN ('BANK','BANK_ACCOUNT','CARD','MOBILE_WALLET') END ORDER BY created_at DESC LIMIT 100`,[p.userId,kind])).rows};
  }));
  app.post('/v1/linqasend/wallet-money/quotes',rate,wrap(async r=>{const p=await auth(r);requireScope(p,'linqasend:write');return money.quote(p.userId,moneyRequest.parse(r.body));}));
  app.get('/v1/linqasend/wallet-money/operations',wrap(async r=>{const p=await auth(r);requireScope(p,'linqasend:read');return money.list(p.userId);}));
  app.post('/v1/linqasend/wallet-money/quotes/:id/challenge',rate,wrap(async r=>{
    const p=await auth(r);requireScope(p,'linqasend:write');const principal=biometricPrincipal(p,r);
    if(!bio||config.LINQASEND_REAL_MONEY_ENABLED!==true)throw new Error('WALLET_MONEY_RELEASE_NOT_READY');
    return bio.transaction(async c=>{
      await bio.guard(c,principal);
      const row=(await c.query(`SELECT snapshot FROM linqasend_wallet_money_quotes WHERE id=$1 AND user_id=$2 AND expires_at>now()`,[id(r),p.userId])).rows[0];
      if(!row)throw new Error('WALLET_QUOTE_EXPIRED_OR_NOT_OWNED');
      const result=(await c.query(`INSERT INTO linqasend_wallet_money_challenges(quote_id,user_id,device_id,session_id,installation_id,snapshot) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,expires_at`,[id(r),p.userId,principal.deviceId,principal.sessionId,principal.installationId,JSON.stringify(row.snapshot)])).rows[0];return {challengeId:result.id,expiresAt:result.expires_at};
    });
  }));
  app.post('/v1/linqasend/wallet-money/quotes/:id/submit',rate,wrap(async r=>{
    const p=await auth(r);requireScope(p,'linqasend:write');const principal=biometricPrincipal(p,r);
    if(!bio||config.LINQASEND_REAL_MONEY_ENABLED!==true)throw new Error('WALLET_MONEY_RELEASE_NOT_READY');
    const input=z.object({challengeId:z.string().uuid(),biometricGrantId:z.string().uuid()}).strict().parse(r.body);
    return money.submit(p.userId,id(r),async(c,s)=>{
      await bio.guard(c,principal);const resource=await bio.resource(c,principal,'SEND_WALLET_AUTHORIZE',{itemId:input.challengeId});
      if(canonical(moneySnapshot.parse(resource))!==canonical(s))throw new Error('WALLET_AUTHORIZATION_MISMATCH');
      await bio.consume(c,principal,input.biometricGrantId,'SEND_WALLET_AUTHORIZE',resource);
      await c.query(`UPDATE linqasend_wallet_money_challenges SET consumed_at=now() WHERE id=$1`,[input.challengeId]);
      return {deviceId:principal.deviceId,sessionId:principal.sessionId,installationId:principal.installationId};
    });
  }));
  app.post('/v1/linqasend/wallet-money/operations/:id/cancel',rate,wrap(async r=>{const p=await auth(r);requireScope(p,'linqasend:write');return money.cancel(p.userId,id(r));}));
  app.post('/v1/linqasend/wallet-money/quotes/:id/resolve',rate,wrap(async r=>{const p=await auth(r);requireScope(p,'linqasend:write');return money.resolvePending(p.userId,id(r));}));
  app.post('/v1/linqasend/wallet-money/operations/:id/refund',rate,wrap(async r=>{const p=await auth(r);requireScope(p,'linqasend:write');const input=z.object({reasonCode:z.enum(['CANCELED_SERVICE','WRONG_RECIPIENT','OTHER'])}).strict().parse(r.body);return money.requestRefund(p.userId,id(r),input.reasonCode);}));
}
