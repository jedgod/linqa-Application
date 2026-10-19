import { z } from "zod";
import type { LinqaSendProviders } from "./provider.contracts.js";
import { moneyPricing,moneyOutcome,allowedHostedUrl } from './wallet-money.contracts.js';

const kycResult = z.object({ decision: z.enum(["PASS", "REVIEW", "FAIL"]), reasons: z.array(z.string()) });
const complianceResult = z.object({ decision: z.enum(["CLEAR", "REVIEW", "BLOCK"]), reasons: z.array(z.string()) });
const fundingResult = z.object({ status: z.enum(["AUTHORIZED", "REQUIRES_ACTION", "DECLINED"]), providerRef: z.string().optional(), declineCode: z.string().optional() });
const walletCredit=z.object({userId:z.string().uuid(),amountMinor:z.string().regex(/^\d{1,19}$/),currency:z.string().regex(/^[A-Z]{3}$/),regulatoryEntityId:z.string().min(1),jurisdiction:z.string().regex(/^[A-Z]{2}$/),jurisdictionVersion:z.number().int().positive()});
const payoutResult = z.object({ status: z.enum(["SUBMITTED", "PROCESSING", "COMPLETED", "FAILED"]), providerRef: z.string().min(1),walletCredit:walletCredit.optional() });
const custodyBalance=z.object({providerId:z.string().min(1),regulatoryEntityId:z.string().min(1),currency:z.string().regex(/^[A-Z]{3}$/),accountReference:z.string().min(1),snapshotId:z.string().min(1),balanceMinor:z.string().regex(/^\d{1,19}$/),asOf:z.string().datetime({offset:true})});
const custodyReceipt=z.object({providerId:z.string().min(1),transferId:z.string().min(1),providerRef:z.string().min(1),status:z.literal('SETTLED'),walletCredit});
const walletCapabilities=z.object({version:z.literal('LINQASEND_WALLET_V1'),custodyBalances:z.boolean(),custodyReceiptLookup:z.boolean(),payoutLookupByIdempotencyKey:z.boolean(),senderFeeRefunds:z.boolean().optional()});
const fundingRefundResult = z.object({ status: z.enum(["REFUNDED", "PENDING", "FAILED"]), providerRef: z.string().min(1), fundingProviderRef: z.string().min(1), amountMinor: z.string().regex(/^[1-9]\d{0,18}$/), currency: z.string().regex(/^[A-Z]{3}$/) }).strict();
const fxResult = z.object({ marketRate: z.string(), executionRate: z.string(), validUntil: z.coerce.date(), sourceTimestamp: z.coerce.date() });

export function createHttpLinqaSendProviders(baseUrl: string, token: string): LinqaSendProviders {
  const request = async <T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(10_000),redirect:"error"
    });
    if (!response.ok) throw new Error(`linqasend_provider_error:${response.status}`);
    return schema.parse(await response.json());
  };
  const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) => request(path, schema, { method: "POST", body: JSON.stringify(body, (_key, value) => typeof value === "bigint" ? value.toString() : value) });
  return {
    walletMoney:{
      capabilities:()=>request('/capabilities/wallet-money',z.object({version:z.literal('LINQASEND_MONEY_V1'),bankLinking:z.boolean(),amountWithdrawals:z.boolean(),internalLedger:z.boolean(),settledTopups:z.boolean(),externalPayments:z.boolean(),returns:z.boolean(),refunds:z.boolean()}).strict()),
      requestRefund:input=>post('/wallet-money/refunds',moneyOutcome,input),
      quote:input=>post('/wallet-money/quotes',moneyPricing,input),
      execute:async input=>{const r=await post('/wallet-money/operations',moneyOutcome,input);if(r.actionUrl)r.actionUrl=allowedHostedUrl(r.actionUrl,baseUrl);return r;},
      lookup:async key=>{const r=await request(`/wallet-money/operations/lookup/${encodeURIComponent(key)}`,moneyOutcome.nullable());if(r?.actionUrl)r.actionUrl=allowedHostedUrl(r.actionUrl,baseUrl);return r;},
      beginBankLink:async input=>{const r=await post('/bank-links',z.object({providerSessionId:z.string().min(1),url:z.string().url(),expiresAt:z.string().datetime({offset:true})}).strict(),input);return {...r,url:allowedHostedUrl(r.url,baseUrl)};},
      bankLinkStatus:key=>request(`/bank-links/${encodeURIComponent(key)}`,z.object({userId:z.string().uuid(),type:z.enum(['BANK_ACCOUNT','DEBIT_CARD']),providerId:z.string().min(1),providerReference:z.string().min(1),country:z.string().regex(/^[A-Z]{2}$/),currency:z.string().regex(/^[A-Z]{3}$/),last4:z.string().regex(/^\d{4}$/),ownershipVerified:z.boolean(),fundingEnabled:z.boolean(),payoutEnabled:z.boolean(),expiresAt:z.string().datetime({offset:true})}).strict().nullable())
    },
    custody:{
      getBalance:scope=>post('/custody/balances/lookup',custodyBalance,scope),
      lookupReceipt:key=>request(`/custody/receipts/lookup/${encodeURIComponent(key)}`,custodyReceipt.nullable()),
      capabilities:()=>request('/capabilities/wallet',walletCapabilities)
    },
    kyc: { name: "http-provider-gateway", verifyIdentity: input => post("/kyc/verify", kycResult, input) },
    compliance: { name: "http-provider-gateway", screenPerson: input => post("/compliance/screen", complianceResult, input) },
    funding: {
      name: "http-provider-gateway",
      authorizeFunding: input => post("/funding/authorize", fundingResult, input),
      lookupByIdempotencyKey: key => request(`/funding/lookup/${encodeURIComponent(key)}`, fundingResult.nullable()),
      refundFee: input => post("/funding/refunds", fundingRefundResult, input),
      lookupRefundByIdempotencyKey: key => request(`/funding/refunds/lookup/${encodeURIComponent(key)}`, fundingRefundResult.nullable())
    },
    payout: {
      name: "http-provider-gateway",
      createPayout: input => post("/payouts", payoutResult, input),
      lookup: reference => request(`/payouts/${encodeURIComponent(reference)}`, payoutResult.nullable()),
      lookupByIdempotencyKey: key => request(`/payouts/lookup/${encodeURIComponent(key)}`, payoutResult.nullable())
    },
    fx: { fetchFxRate: input => post("/fx/quote", fxResult, input) }
  };
}
