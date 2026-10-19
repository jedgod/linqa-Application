import type { AppConfig } from "../../config.js";
import type { Database } from "../../db/pool.js";
import type { WithdrawalPolicy } from "./deposit.service.js";
import { DepositError } from "./deposit.service.js";
import type { ProviderTokenVaultService } from "./provider-token-vault.service.js";
import { ResponsibilityExecutionGuard } from "./v7-execution-guard.js";
import { FundingMode,ReceiveMode,RecipientType,RegulatoryCapabilityEngine,TransferClassifier,type SenderContext,type ResolvedRecipient } from "./classification-v3.js";
import { PgCapabilityRepository } from "./capability-repository.pg.js";
import { RegulatedEntityResolverV7 } from "./regulatory-v7.js";
import { ProviderCustodyService } from './provider-custody.service.js';

export function createWithdrawalPolicy(db: Database,config: AppConfig,vault?: ProviderTokenVaultService):WithdrawalPolicy {
  return {
    async authorizePayout(row) {
      if(config.LINQASEND_REAL_MONEY_ENABLED!==true || !vault)throw new DepositError("withdrawal_provider_not_ready");
      const ok=await db.query(`SELECT w.currency,w.jurisdiction,w.regulatory_entity_id,c.kyc_level,m.type,m.billing_country FROM linqasend_wallet_accounts_v2 w JOIN users u ON u.id=w.user_id AND u.status='ACTIVE'
        JOIN user_jurisdiction_profiles_v2 p ON p.user_id=w.user_id AND p.regulatory_entity_id=w.regulatory_entity_id
        AND p.regulatory_jurisdiction=w.jurisdiction AND p.jurisdiction_version=w.jurisdiction_version
        JOIN linqasend_customer_compliance_profiles_v7 c ON c.user_id=w.user_id AND c.verified_country=w.jurisdiction AND c.kyc_status='VERIFIED' AND (c.expires_at IS NULL OR c.expires_at>now())
        JOIN linqasend_payment_methods m ON m.id=$3 AND m.user_id=w.user_id AND m.deleted_at IS NULL AND m.verification_status='VERIFIED'
        AND m.provider=$4 AND m.provider_payment_method_ref=$5
        AND m.type::text IN ('BANK_ACCOUNT','DEBIT_CARD') AND m.billing_country=w.jurisdiction
        WHERE w.id=$1 AND w.user_id=$2 AND w.status='ACTIVE' AND w.subledger_enabled
        AND EXISTS(SELECT 1 FROM linqasend_kill_switches WHERE scope_type='GLOBAL' AND scope_id='*' AND active=false)
        AND NOT EXISTS(SELECT 1 FROM linqasend_kill_switches WHERE active AND (scope_type='GLOBAL' OR scope_type='PROVIDER' AND scope_id=$4))
        AND EXISTS(SELECT 1 FROM linqasend_provider_certifications_v6 WHERE provider_id=$4 AND status='CERTIFIED' AND expires_at>now())`,
        [row.wallet_id,row.receiver_user_id,row.payment_method_id,row.provider_id,row.destination_ref]);
      if(!ok.rows[0])throw new DepositError("withdrawal_policy_denied");
      await new ProviderCustodyService(db).assertWalletCovered(row.wallet_id);
      await new ResponsibilityExecutionGuard(db).authorize(row.transfer_id,row.provider_id);
      // Receipt authorization is not cash-out authorization: resolve the receiver's wallet -> bank/card route independently.
      const w=ok.rows[0],currency=w.currency.trim();
      const receiveMode=w.type==='DEBIT_CARD'?ReceiveMode.CARD:ReceiveMode.BANK;
      const sender:SenderContext={userId:row.receiver_user_id,verifiedCountry:w.jurisdiction,baseCurrency:currency,kycLevel:w.kyc_level,kycStatus:'VERIFIED',riskScore:0,deviceTrust:'UNKNOWN',accountStatus:'ACTIVE'};
      const recipient:ResolvedRecipient={recipientId:row.payment_method_id,recipientType:w.type==='DEBIT_CARD'?RecipientType.CARD_RECIPIENT:RecipientType.BANK_RECIPIENT,
        verifiedCountry:w.billing_country,receiveCurrency:currency,receiveMode,verified:true};
      const classification=new TransferClassifier().classify(sender,recipient);
      const decision=await new RegulatoryCapabilityEngine(new PgCapabilityRepository(db)).decide({sender,recipient,classification,amount:{amountMinor:BigInt(row.amount_minor),currency},fundingMode:FundingMode.LINQA_BALANCE,receiveMode});
      if(!decision.allowed||!decision.corridorRuleId)throw new DepositError("withdrawal_capability_denied");
      const rule=await db.query(`SELECT 1 FROM linqasend_corridor_rules_v3 WHERE id=$1 AND provider_id=$2 AND NOT requires_manual_review AND NOT requires_source_of_funds`,[decision.corridorRuleId,row.provider_id]);
      const kills=await db.query(`SELECT 1 FROM linqasend_kill_switches WHERE active AND ((scope_type='CORRIDOR' AND scope_id=$1) OR (scope_type='RAIL' AND scope_id=ANY($2::text[])))`,[decision.corridorRuleId,decision.permittedRails]);
      if(!rule.rows[0]||kills.rows.length)throw new DepositError("withdrawal_capability_denied");
      const resolution=await new RegulatedEntityResolverV7(db).resolve({sourceCountry:w.jurisdiction,destinationCountry:w.billing_country,transferClass:classification.transferClass,
        sourceCurrency:currency,destinationCurrency:currency,fundingMode:FundingMode.LINQA_BALANCE,receiveMode});
      const payoutResponsibility=receiveMode===ReceiveMode.CARD?'CARD_PUSH_PAYOUT':'LOCAL_BANK_PAYOUT';
      if(!resolution.complete || !resolution.authorities.some(a=>a.responsibility===payoutResponsibility&&a.providerAdapterKey===row.provider_id)
        || !resolution.authorities.some(a=>a.responsibility==='CUSTOMER_FUNDS_CUSTODY'&&a.entityId===w.regulatory_entity_id))throw new DepositError("withdrawal_responsibility_not_configured");
      await db.query(`INSERT INTO linqasend_wallet_policy_audit(wallet_id,withdrawal_id,provider_id,evidence) VALUES($1,$2,$3,$4)`,[row.wallet_id,row.id??null,row.provider_id,JSON.stringify({amountMinor:String(row.amount_minor),currency,decision,resolution})]);
    },
    async resolveDestination(reference,owner) {
      if(!vault)throw new DepositError("withdrawal_provider_not_ready");
      return vault.resolve(reference,{actorId:"wallet-withdrawal-worker",purpose:"WITHDRAWAL_PAYOUT",expectedOwnerUserId:owner});
    }
  };
}
