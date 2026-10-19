import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import type { Database } from "../../db/pool.js";
import { createPaymentAuthenticator } from "../../auth/payment-authenticator.js";
import { InactivePrincipalError } from "../../auth/active-principal.js";
import { requireScope } from "../../auth/jwt.js";
import { biometricPrincipal } from "../biometrics.js";
import type { BiometricAuthorizationService } from "../../security/biometrics/service.js";
import type { PayoutProvider } from "../../integrations/linqasend/provider.contracts.js";
import { DepositService, assertWithdrawalSnapshot } from "../../services/linqasend/deposit.service.js";
import { WalletLedgerService } from "../../services/linqasend/wallet-ledger.service.js";
import { createWithdrawalPolicy } from "../../services/linqasend/withdrawal-policy.js";
import { ProviderTokenVaultService } from "../../services/linqasend/provider-token-vault.service.js";
import { AwsProductionKmsProvider } from "../../security/kms/production-kms-provider.js";

export async function registerWalletRoutes(app:FastifyInstance,config:AppConfig,db:Database,payout:PayoutProvider,bio?:BiometricAuthorizationService) {
  const auth=createPaymentAuthenticator(config,db),deposits=new DepositService(db,payout),ledger=new WalletLedgerService(db);
  const vault=config.LINQASEND_TOKEN_KMS_KEY_ID&&config.LINQASEND_TOKEN_KMS_REGION?new ProviderTokenVaultService(db,new AwsProductionKmsProvider(config.LINQASEND_TOKEN_KMS_KEY_ID,config.LINQASEND_TOKEN_KMS_REGION),config.LINQASEND_TOKEN_KMS_KEY_ID):undefined;
  const policy=createWithdrawalPolicy(db,config,vault);
  const assertReady=async(input:Parameters<DepositService['preview']>[0])=>{
    const preview=await deposits.preview(input),s=preview.snapshot;
    await policy.authorizePayout({wallet_id:s.walletId,receiver_user_id:s.userId,payment_method_id:s.paymentMethodId,provider_id:s.providerId,destination_ref:preview.destinationRef,transfer_id:s.transferId,amount_minor:s.amountMinor});
    return preview;
  };
  const wrap=(work:(req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>)=>async(req:FastifyRequest,reply:FastifyReply)=>{
    try{return await work(req,reply);}catch(error){
      if(error instanceof InactivePrincipalError)return reply.code(401).send({error:"authentication_revoked"});
      if(error instanceof z.ZodError)return reply.code(422).send({error:"validation_error"});
      req.log.warn({err:error},"wallet request rejected");
      return reply.code(409).send({error:error instanceof Error?error.message:"wallet_request_denied"});
    }
  };
  const safe=(v:unknown)=>JSON.parse(JSON.stringify(v,(_k,v)=>typeof v==="bigint"?v.toString():v));
  const choice=z.object({option:z.enum(["instant","standard"]),paymentMethodId:z.string().uuid()});
  const transferId=(req:FastifyRequest)=>z.object({id:z.string().min(1).max(64)}).parse(req.params).id;
  app.get("/v1/linqasend/wallets",wrap(async req=>{const p=await auth(req);requireScope(p,"linqasend:read");return ledger.summary(p.userId);}));
  app.get("/v1/linqasend/wallets/:id/activity",wrap(async req=>{const p=await auth(req);requireScope(p,"linqasend:read");return ledger.activity(p.userId,z.string().uuid().parse(transferId(req)));}));
  app.get("/v1/linqasend/wallet-receipts",wrap(async req=>{
    const p=await auth(req);requireScope(p,"linqasend:read");
    const r=await db.query(`SELECT t.public_id AS id,t.receive_amount_minor AS amount_minor,t.receive_currency AS currency,t.created_at,d.status AS withdrawal_status,d.id AS withdrawal_id
      FROM linqasend_wallet_journals j JOIN linqasend_wallet_postings wp ON wp.journal_id=j.id AND wp.bucket='AVAILABLE'
      JOIN linqasend_wallet_accounts_v2 w ON w.id=wp.wallet_id JOIN linqasend_transfers t ON t.id=j.transfer_id
      LEFT JOIN linqasend_deposit_requests d ON d.transfer_id=t.id
      WHERE w.user_id=$1 AND j.kind='RECEIPT' ORDER BY j.created_at DESC LIMIT 100`,[p.userId]);
    return {items:r.rows.map(r=>({...r,amount_minor:String(r.amount_minor)}))};
  }));
  app.post('/v1/linqasend/wallet-withdrawals/:id/cancel',wrap(async req=>{
    const p=await auth(req);requireScope(p,'linqasend:write');
    return deposits.cancel(p.userId,z.string().uuid().parse(transferId(req)));
  }));
  app.get("/v1/linqasend/transfers/:id/deposit-options",wrap(async req=>{const p=await auth(req);requireScope(p,"linqasend:read");return safe(await deposits.options(p.userId,transferId(req)));}));
  app.post("/v1/linqasend/transfers/:id/withdrawal-challenge",wrap(async req=>{
    const p=await auth(req);requireScope(p,"linqasend:write");const principal=biometricPrincipal(p,req);
    if(!bio||config.LINQASEND_REAL_MONEY_ENABLED!==true)throw new Error("withdrawal_provider_not_ready");
    const body=choice.strict().parse(req.body);
    const {snapshot}=await assertReady({userId:p.userId,publicId:transferId(req),...body});
    return bio.transaction(async client=>{
      await bio.guard(client,principal);
      const row=(await client.query(`INSERT INTO linqasend_withdrawal_challenges(user_id,device_id,session_id,installation_id,snapshot)
        VALUES($1,$2,$3,$4,$5) RETURNING id,expires_at`,[p.userId,principal.deviceId,principal.sessionId,principal.installationId,JSON.stringify(snapshot)])).rows[0];
      return {challengeId:row.id,expiresAt:row.expires_at};
    });
  }));
  app.post("/v1/linqasend/transfers/:id/deposit",wrap(async(req,reply)=>{
    const p=await auth(req);requireScope(p,"linqasend:write");const principal=biometricPrincipal(p,req);
    if(!bio||config.LINQASEND_REAL_MONEY_ENABLED!==true)throw new Error("withdrawal_provider_not_ready");
    const body=choice.extend({challengeId:z.string().uuid(),biometricGrantId:z.string().uuid()}).strict().parse(req.body);
    await assertReady({userId:p.userId,publicId:transferId(req),option:body.option,paymentMethodId:body.paymentMethodId});
    const result=await deposits.request({userId:p.userId,publicId:transferId(req),option:body.option,paymentMethodId:body.paymentMethodId},async(client,snapshot)=>{
      await bio.guard(client,principal);
      const resource=await bio.resource(client,principal,"SEND_CASHOUT_AUTHORIZE",{itemId:body.challengeId});
      assertWithdrawalSnapshot(resource,snapshot);
      await bio.consume(client,principal,body.biometricGrantId,"SEND_CASHOUT_AUTHORIZE",resource);
      await client.query(`UPDATE linqasend_withdrawal_challenges SET consumed_at=now() WHERE id=$1`,[body.challengeId]);
    });
    return reply.code(201).send(safe(result));
  }));
}
