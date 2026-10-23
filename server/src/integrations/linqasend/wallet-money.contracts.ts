import { z } from 'zod';

const integerPattern=/^(0|[1-9]\d{0,18})$/;
export const minor = z.string().regex(integerPattern).refine(v=>integerPattern.test(v)&&BigInt(v)<=9223372036854775807n);
export const positiveMinor=minor.refine(v=>integerPattern.test(v)&&BigInt(v)>0n);
export const walletMoneyKind=z.enum(['WITHDRAW','INTERNAL','TOPUP','EXTERNAL']);
export const moneyRequest=z.object({walletId:z.string().uuid(),kind:walletMoneyKind,amountMinor:positiveMinor,targetId:z.string().uuid()}).strict();
export type MoneyRequest=z.infer<typeof moneyRequest>;
export const moneySnapshot=z.object({
  id:z.string().uuid(),userId:z.string().uuid(),walletId:z.string().uuid(),kind:walletMoneyKind,
  amountMinor:positiveMinor,feeMinor:minor,totalMinor:positiveMinor,currency:z.string().regex(/^[A-Z]{3}$/),
  receiveAmountMinor:positiveMinor,receiveCurrency:z.string().regex(/^[A-Z]{3}$/),
  entityId:z.string().min(1),country:z.string().regex(/^[A-Z]{2}$/),jurisdictionVersion:z.number().int().positive(),
  targetId:z.string().uuid(),targetCountry:z.string().regex(/^[A-Z]{2}$/),targetHash:z.string().length(64),
  targetWalletId:z.string().uuid().nullable(),providerId:z.string().min(1),providerQuoteId:z.string().nullable(),
  expiresAt:z.string().datetime({offset:true}),estimatedArrival:z.string().max(200),fxRate:z.string().regex(/^\d+(\.\d+)?$/).max(100).refine(v=>Number.isFinite(Number(v))&&Number(v)>0),
  // Present only when the quote pays a one-time invoice. Absent (not null) otherwise, so existing snapshots hash identically.
  invoiceId:z.string().uuid().optional(),
}).strict();
export type MoneySnapshot=z.infer<typeof moneySnapshot>;
export const moneyPricing=z.object({quoteId:z.string().min(1),amountMinor:positiveMinor,currency:z.string().regex(/^[A-Z]{3}$/),feeMinor:minor,totalMinor:positiveMinor,receiveAmountMinor:positiveMinor,receiveCurrency:z.string().regex(/^[A-Z]{3}$/),expiresAt:z.string().datetime({offset:true}),estimatedArrival:z.string().max(200),fxRate:z.string().regex(/^\d+(\.\d+)?$/).max(100).refine(v=>Number.isFinite(Number(v))&&Number(v)>0)}).strict();
export const moneyOutcome=z.object({operationId:z.string().uuid(),providerQuoteId:z.string().min(1),providerId:z.string().min(1),
  providerRef:z.string().min(1),eventId:z.string().min(1),status:z.enum(['PROCESSING','ACTION_REQUIRED','SETTLED','FAILED','RETURNED']),
  // Hash of the complete authorized local snapshot; all lookup/return evidence must match.
  snapshotHash:z.string().length(64),amountMinor:positiveMinor,currency:z.string().regex(/^[A-Z]{3}$/),
  // Cumulative returned source currency: monotone, bounded by the original operation.
  returnedMinor:minor.default('0'),returnedFeeMinor:minor.default('0'),actionUrl:z.string().url().optional(),
}).strict();
export type MoneyOutcome=z.infer<typeof moneyOutcome>;
/**
 * What the rail must pay out, stated explicitly so a gateway never has to infer it from the quote's amount, fee and total.
 * The recipient receives `recipientAmountMinor` and nothing else: the platform fee is retained by the platform and is never
 * part of the payout. Sent only for operations that pay out (cash out and outside sends).
 */
export type PayoutInstruction={sourceAmountMinor:string;sourceCurrency:string;recipientAmountMinor:string;recipientCurrency:string;platformFeeMinor:string;platformFeeRetained:true};
export function payoutInstruction(s:MoneySnapshot):PayoutInstruction{
  // The total debited from the wallet must be exactly the payout source amount plus the retained fee; anything else is a pricing bug.
  if(BigInt(s.totalMinor)!==BigInt(s.amountMinor)+BigInt(s.feeMinor)||BigInt(s.receiveAmountMinor)<=0n)throw new Error('WALLET_PAYOUT_INSTRUCTION_INVALID');
  return {sourceAmountMinor:s.amountMinor,sourceCurrency:s.currency,recipientAmountMinor:s.receiveAmountMinor,recipientCurrency:s.receiveCurrency,platformFeeMinor:s.feeMinor,platformFeeRetained:true};
}
export interface WalletMoneyGateway {
  capabilities():Promise<{version:'LINQASEND_MONEY_V1';bankLinking:boolean;amountWithdrawals:boolean;internalLedger:boolean;settledTopups:boolean;externalPayments:boolean;returns:boolean;refunds:boolean}>;
  quote(input:{operationId:string;kind:MoneySnapshot['kind'];userId:string;amountMinor:string;currency:string;receiveCurrency:string;targetReference:string;entityId:string}):Promise<z.infer<typeof moneyPricing>>;
  execute(input:{snapshot:MoneySnapshot;snapshotHash:string;targetReference:string;idempotencyKey:string;payout?:PayoutInstruction}):Promise<MoneyOutcome>;
  lookup(idempotencyKey:string):Promise<MoneyOutcome|null>;
  requestRefund(input:{operationId:string;idempotencyKey:string;reasonCode:string}):Promise<MoneyOutcome>;
  beginBankLink(input:{userId:string;sessionId:string;type:'BANK_ACCOUNT'|'DEBIT_CARD'}):Promise<{providerSessionId:string;url:string;expiresAt:string}>;
  bankLinkStatus(providerSessionId:string):Promise<{userId:string;type:'BANK_ACCOUNT'|'DEBIT_CARD';providerId:string;providerReference:string;country:string;currency:string;last4:string;ownershipVerified:boolean;fundingEnabled:boolean;payoutEnabled:boolean;expiresAt:string}|null>;
}
export function checkedPricing(p:z.infer<typeof moneyPricing>,amount:string,currency:string,receiveCurrency:string,kind:MoneySnapshot['kind'],now=Date.now()) {
  p=moneyPricing.parse(p);
  if(p.amountMinor!==amount||p.currency!==currency||p.receiveCurrency!==receiveCurrency||BigInt(p.totalMinor)!==BigInt(amount)+BigInt(p.feeMinor)
    ||Date.parse(p.expiresAt)<=now||Date.parse(p.expiresAt)>now+10*60_000
    ||(kind!=='EXTERNAL'&&receiveCurrency!==currency)||(receiveCurrency===currency&&(p.receiveAmountMinor!==amount||p.fxRate!=='1')))throw new Error('WALLET_QUOTE_MISMATCH');
  return p;
}
export function allowedHostedUrl(value:string,baseUrl:string) {
  const url=new URL(value),base=new URL(baseUrl);
  if(url.protocol!=='https:'||url.origin!==base.origin||url.username||url.password||url.hash)throw new Error('WALLET_HOSTED_URL_DENIED');
  return url.href;
}
