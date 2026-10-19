import type { PoolClient } from 'pg';
import type { Database } from '../../db/pool.js';
import type { AppConfig } from '../../config.js';
import type { MoneySnapshot } from '../../integrations/linqasend/wallet-money.contracts.js';
import { FundingMode,ReceiveMode,RecipientType,RegulatoryCapabilityEngine,TransferClassifier } from './classification-v3.js';
import { PgCapabilityRepository } from './capability-repository.pg.js';
import { RegulatedEntityResolverV7 } from './regulatory-v7.js';
import { ProviderCustodyService } from './provider-custody.service.js';
import type { ProviderTokenVaultService } from './provider-token-vault.service.js';
import { RiskEngineService } from './risk-engine.service.js';

export interface WalletMoneyPolicy {
  authorize(snapshot:MoneySnapshot,client?:PoolClient):Promise<void>;
  resolve(reference:string,userId:string):Promise<string>;
}
export const denyWalletMoneyPolicy:WalletMoneyPolicy={async authorize(){throw new Error('WALLET_MONEY_NOT_CONFIGURED');},async resolve(){throw new Error('WALLET_MONEY_NOT_CONFIGURED');}};

export function createWalletMoneyPolicy(db:Database,config:AppConfig,vault?:ProviderTokenVaultService):WalletMoneyPolicy {
  return {
    async resolve(reference,userId){
      if(!vault||!reference.startsWith('vault:'))throw new Error('WALLET_TOKEN_VAULT_REQUIRED');
      return vault.resolve(reference,{actorId:'wallet-money',purpose:'WALLET_MONEY_EXECUTION',expectedOwnerUserId:userId});
    },
    async authorize(s,client){
      if(!config.LINQASEND_REAL_MONEY_ENABLED||!vault||config.LINQASEND_MODE!=='GENERAL_AVAILABILITY'
        ||!config.LINQASEND_RELEASE_GIT_SHA||!config.LINQASEND_ARTIFACT_SHA256)throw new Error('WALLET_MONEY_RELEASE_NOT_READY');
      // All calls use only query(); during submission this is the transaction holding the wallet locks.
      const q=client??db,reader=q as Database;
      const wallet=(await q.query(`SELECT w.*,c.kyc_level FROM linqasend_wallet_accounts_v2 w JOIN users u ON u.id=w.user_id AND u.status='ACTIVE'
        JOIN user_jurisdiction_profiles_v2 p ON p.user_id=w.user_id AND p.regulatory_entity_id=w.regulatory_entity_id AND p.regulatory_jurisdiction=w.jurisdiction AND p.jurisdiction_version=w.jurisdiction_version
        JOIN linqasend_customer_compliance_profiles_v7 c ON c.user_id=w.user_id AND c.kyc_status='VERIFIED' AND c.verified_country=w.jurisdiction AND (c.expires_at IS NULL OR c.expires_at>now())
        WHERE w.id=$1 AND w.user_id=$2 AND w.status='ACTIVE' AND w.subledger_enabled`,[s.walletId,s.userId])).rows[0];
      if(!wallet||wallet.currency.trim()!==s.currency||wallet.regulatory_entity_id!==s.entityId||wallet.jurisdiction!==s.country||wallet.jurisdiction_version!==s.jurisdictionVersion)throw new Error('WALLET_SCOPE_CHANGED');
      if((await q.query(`SELECT active FROM linqasend_kill_switches WHERE scope_type='GLOBAL' AND scope_id='*'`)).rows[0]?.active!==false
        ||(await q.query(`SELECT 1 FROM linqasend_kill_switches WHERE active AND (scope_type='GLOBAL' OR scope_type='PROVIDER' AND scope_id=$1)`,[s.providerId])).rowCount)throw new Error('WALLET_MONEY_PAUSED');
      const security=await q.query(`SELECT 1 FROM linqasend_security_change_events_v4 WHERE user_id=$1 AND event_at>now()-interval '24 hours' LIMIT 1`,[s.userId]);
      if(security.rowCount)throw new Error('WALLET_SECURITY_COOLDOWN');
      const operation=(await q.query(`SELECT authorization_context FROM linqasend_wallet_money_operations WHERE id=$1`,[s.id])).rows[0];
      if(operation){
        const p=operation.authorization_context;
        const trusted=await q.query(`SELECT 1 FROM devices d JOIN auth_sessions a ON a.device_id=d.id AND a.user_id=d.user_id AND a.id=$3 AND a.revoked_at IS NULL AND a.expires_at>now()
          JOIN trusted_installation_devices_v3 t ON t.device_id=d.id AND t.user_id=d.user_id AND t.installation_id=$4 AND t.trust_state='TRUSTED' AND t.revoked_at IS NULL
          JOIN device_installations_v2 i ON i.id=t.installation_id AND i.trust_state='TRUSTED'
          JOIN installation_accounts_v2 ia ON ia.installation_id=i.id AND ia.user_id=d.user_id AND ia.state='ACTIVE'
          JOIN biometric_security_state b ON b.user_id=d.user_id AND NOT b.recovery_in_progress AND (b.locked_until IS NULL OR b.locked_until<=now())
          WHERE d.user_id=$1 AND d.id=$2 AND d.status='ACTIVE' AND d.revoked_at IS NULL`,[s.userId,p.deviceId??null,p.sessionId??null,p.installationId??null]);
        if(!trusted.rowCount)throw new Error('WALLET_AUTHORIZATION_PRINCIPAL_REVOKED');
      }
      const limits=(await q.query(`SELECT * FROM linqasend_wallet_money_limits WHERE regulatory_entity_id=$1 AND currency=$2 AND active`,[s.entityId,s.currency])).rows[0];
      if(!limits||BigInt(s.totalMinor)>BigInt(limits.per_operation_minor))throw new Error('WALLET_OPERATION_LIMIT_DENIED');
      // Include legacy cash-outs and sends so changing entry points cannot reset daily spend.
      const used=(await q.query(`SELECT
        coalesce((SELECT sum((snapshot->>'totalMinor')::numeric) FROM linqasend_wallet_money_operations WHERE user_id=$1 AND snapshot->>'currency'=$2 AND id<>$3 AND created_at>now()-interval '24 hours' AND status NOT IN ('FAILED','CANCELED')),0)
        +coalesce((SELECT sum(amount_minor) FROM linqasend_deposit_requests WHERE receiver_user_id=$1 AND currency=$2 AND created_at>now()-interval '24 hours' AND status NOT IN ('FAILED','CANCELED')),0)
        +coalesce((SELECT sum(send_amount_minor) FROM linqasend_transfers WHERE user_id=$1 AND send_currency=$2 AND created_at>now()-interval '24 hours' AND status NOT IN ('FAILED','DECLINED','CANCELED','EXPIRED')),0) AS amount`,[s.userId,s.currency,s.id])).rows[0];
      if(BigInt(used.amount)+BigInt(s.totalMinor)>BigInt(limits.daily_minor))throw new Error('WALLET_DAILY_LIMIT_EXCEEDED');
      const risk=(await q.query(`SELECT u.created_at AS account_created_at,r.risk_score,
        EXISTS(SELECT 1 FROM linqasend_security_change_events_v4 WHERE user_id=$1 AND event_type IN ('SIM_CHANGED','SIM_SWAP_DETECTED','ACCOUNT_RECOVERY_COMPLETED') AND event_at>now()-interval '72 hours') AS recent_security,
        EXISTS(SELECT 1 FROM linqasend_money_adjustments_v5 m JOIN linqasend_transfers t ON t.id=m.transfer_id WHERE t.user_id=$1 AND m.adjustment_type='CHARGEBACK') AS chargebacks
        FROM users u JOIN linqasend_country_risk_signals r ON r.country=$2 AND r.expires_at>now() AND r.observed_at>now()-interval '1 hour' WHERE u.id=$1`,[s.userId,s.country])).rows[0];
      if(!risk||risk.recent_security||risk.chargebacks)throw new Error('WALLET_RISK_EVIDENCE_REQUIRED');
      const scored=new RiskEngineService().evaluate({amountMinor:BigInt(s.totalMinor),isNewRecipient:true,isNewPaymentMethod:s.kind==='TOPUP'||s.kind==='WITHDRAW',accountAgeDays:Math.max(0,Math.floor((Date.now()-new Date(risk.account_created_at).getTime())/86400000)),recentPasswordReset:false,recentSimChange:risk.recent_security,velocity24hMinor:BigInt(used.amount),deviceTrusted:true,countryRiskScore:risk.risk_score});
      if(!['ALLOW','ALLOW_STEP_UP'].includes(scored.decision))throw new Error('WALLET_RISK_REVIEW_REQUIRED');
      const sourceType=s.kind==='TOPUP'?(await q.query(`SELECT type FROM linqasend_payment_methods WHERE id=$1 AND user_id=$2`,[s.targetId,s.userId])).rows[0]?.type:null;
      const funding=s.kind==='TOPUP'?(sourceType==='BANK_ACCOUNT'?FundingMode.BANK:sourceType==='DEBIT_CARD'?FundingMode.DEBIT_CARD:null):FundingMode.LINQA_BALANCE;
      if(!funding)throw new Error('WALLET_FUNDING_TYPE_DENIED');
      const target=s.kind==='EXTERNAL'?(await q.query(`SELECT recipient_type FROM linqasend_recipients WHERE id=$1 AND owner_user_id=$2`,[s.targetId,s.userId])).rows[0]?.recipient_type:null;
      const method=s.kind==='WITHDRAW'?(await q.query(`SELECT type FROM linqasend_payment_methods WHERE id=$1 AND user_id=$2`,[s.targetId,s.userId])).rows[0]?.type:null;
      const receive=s.kind==='TOPUP'||s.kind==='INTERNAL'?ReceiveMode.LINQA_BALANCE:method==='DEBIT_CARD'||target==='CARD'?ReceiveMode.CARD:target==='MOBILE_WALLET'?ReceiveMode.MOBILE_MONEY:ReceiveMode.BANK;
      const sender={userId:s.userId,verifiedCountry:s.country,baseCurrency:s.currency,kycLevel:wallet.kyc_level,kycStatus:'VERIFIED' as const,riskScore:0,deviceTrust:'UNKNOWN' as const,accountStatus:'ACTIVE' as const};
      const recipient={recipientId:s.targetId,recipientType:receive===ReceiveMode.LINQA_BALANCE?RecipientType.LINQA_USER:receive===ReceiveMode.CARD?RecipientType.CARD_RECIPIENT:receive===ReceiveMode.MOBILE_MONEY?RecipientType.MOBILE_MONEY_RECIPIENT:RecipientType.BANK_RECIPIENT,verifiedCountry:s.targetCountry,receiveCurrency:s.receiveCurrency,receiveMode:receive,verified:true};
      const classification=new TransferClassifier().classify(sender,recipient);
      const decision=await new RegulatoryCapabilityEngine(new PgCapabilityRepository(reader)).decide({sender,recipient,classification,amount:{amountMinor:BigInt(s.amountMinor),currency:s.currency},fundingMode:funding,receiveMode:receive});
      if(!decision.allowed)throw new Error('WALLET_CAPABILITY_DENIED');
      const rule=(await q.query(`SELECT id,requires_manual_review,requires_source_of_funds FROM linqasend_corridor_rules_v3 WHERE source_country=$1 AND destination_country=$2 AND transfer_class=$3 AND provider_id=$4 AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now()) ORDER BY version DESC LIMIT 1`,[s.country,s.targetCountry,classification.transferClass,s.providerId])).rows[0];
      if(!rule||rule.requires_manual_review||rule.requires_source_of_funds||decision.corridorRuleId&&decision.corridorRuleId!==rule.id)throw new Error('WALLET_CORRIDOR_NOT_READY');
      if((await q.query(`SELECT 1 FROM linqasend_kill_switches WHERE active AND (scope_type='CORRIDOR' AND scope_id=$1 OR scope_type='RAIL' AND scope_id=ANY($2::text[]))`,[rule.id,decision.permittedRails])).rowCount)throw new Error('WALLET_ROUTE_PAUSED');
      const certified=await q.query(`SELECT 1 FROM linqasend_provider_certifications_v6 p,linqasend_corridor_certifications_v6 c,linqasend_release_manifests_v6 r
        WHERE p.provider_id=$1 AND p.git_sha=$2 AND p.status='CERTIFIED' AND p.expires_at>now()
        AND c.corridor_rule_id=$3 AND c.git_sha=$2 AND c.status='CERTIFIED' AND c.physical_tests_passed AND c.failure_tests_passed AND c.expires_at>now()
        AND r.git_sha=$2 AND r.artifact_digest=$4 AND r.status='APPROVED'`,[s.providerId,config.LINQASEND_RELEASE_GIT_SHA,rule.id,config.LINQASEND_ARTIFACT_SHA256]);
      if(!certified.rows[0])throw new Error('WALLET_EXACT_RELEASE_NOT_CERTIFIED');
      const resolution=await new RegulatedEntityResolverV7(reader).resolve({sourceCountry:s.country,destinationCountry:s.targetCountry,transferClass:classification.transferClass,sourceCurrency:s.currency,destinationCurrency:s.receiveCurrency,fundingMode:funding,receiveMode:receive});
      if(!resolution.complete||!resolution.authorities.some(a=>a.responsibility==='CUSTOMER_FUNDS_CUSTODY'&&a.entityId===s.entityId)
        ||!resolution.authorities.some(a=>a.providerAdapterKey===s.providerId))throw new Error('WALLET_RESPONSIBILITY_DENIED');
      if(s.kind==='INTERNAL'){
        const receiver=await q.query(`SELECT 1 FROM linqasend_wallet_accounts_v2 w JOIN users u ON u.id=w.user_id AND u.status='ACTIVE'
          JOIN user_jurisdiction_profiles_v2 p ON p.user_id=w.user_id AND p.regulatory_entity_id=w.regulatory_entity_id AND p.jurisdiction_version=w.jurisdiction_version AND p.regulatory_jurisdiction=w.jurisdiction
          JOIN linqasend_customer_compliance_profiles_v7 c ON c.user_id=w.user_id AND c.kyc_status='VERIFIED' AND c.verified_country=w.jurisdiction AND (c.expires_at IS NULL OR c.expires_at>now())
          WHERE w.id=$1 AND w.status='ACTIVE' AND w.subledger_enabled AND w.regulatory_entity_id=$2 AND w.currency=$3 AND w.jurisdiction=$4`,[s.targetWalletId,s.entityId,s.currency,s.country]);
        if(!receiver.rowCount)throw new Error('WALLET_RECIPIENT_NOT_ELIGIBLE');
      }
      await new ProviderCustodyService(reader).assertWalletCovered(s.walletId);
      await q.query(`INSERT INTO linqasend_wallet_policy_audit(wallet_id,withdrawal_id,provider_id,evidence) VALUES($1,$2,$3,$4)`,[s.walletId,s.id,s.providerId,JSON.stringify({kind:s.kind,decision,resolution,risk:scored})]);
    }
  };
}
