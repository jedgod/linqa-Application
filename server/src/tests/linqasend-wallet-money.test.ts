import { describe,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { allowedHostedUrl,checkedPricing,moneyRequest,moneyOutcome,minor } from '../integrations/linqasend/wallet-money.contracts.js';
import { createWalletMoneyPolicy } from '../services/linqasend/wallet-money-policy.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/pool.js';

describe('wallet money request, pricing and hosted URL boundaries',()=>{
  const price=()=>({quoteId:'approved-quote',amountMinor:'5000',currency:'USD',feeMinor:'100',totalMinor:'5100',receiveAmountMinor:'5000',receiveCurrency:'USD',expiresAt:new Date(Date.now()+60_000).toISOString(),estimatedArrival:'Estimate',fxRate:'1'});
  it('preserves integer precision and rejects unsafe, negative, fractional and overflow values',()=>{
    expect(minor.parse('9007199254740993')).toBe('9007199254740993');
    for(const value of [1,-1,'-1','1.5','01','9223372036854775808'])expect(minor.safeParse(value).success).toBe(false);
  });
  it('rejects client-injected pricing, custody scope and destination references',()=>{
    const input={walletId:randomUUID(),kind:'WITHDRAW',amountMinor:'100',targetId:randomUUID()};
    expect(moneyRequest.safeParse(input).success).toBe(true);
    for(const extra of [{feeMinor:'0'},{providerId:'other'},{targetReference:'bank'}])expect(moneyRequest.safeParse({...input,...extra}).success).toBe(false);
  });
  it('rejects changed amounts, currencies, unbalanced quotes, expiry and hidden same-currency deductions',()=>{
    expect(checkedPricing(price(),'5000','USD','USD','WITHDRAW').totalMinor).toBe('5100');
    for(const change of [{amountMinor:'5001'},{currency:'CAD'},{totalMinor:'5000'},{receiveAmountMinor:'4900'},{fxRate:'NaN'},{expiresAt:new Date(Date.now()-1).toISOString()}])expect(()=>checkedPricing({...price(),...change},'5000','USD','USD','WITHDRAW')).toThrow();
  });
  it('accepts an explicit external FX quote and forbids FX on bank top-ups',()=>{
    const fx={...price(),receiveCurrency:'GBP',receiveAmountMinor:'3900',fxRate:'0.78'};
    expect(checkedPricing(fx,'5000','USD','GBP','EXTERNAL').receiveAmountMinor).toBe('3900');
    expect(()=>checkedPricing(fx,'5000','USD','GBP','TOPUP')).toThrow();
  });
  it('opens only HTTPS hosted pages on the configured gateway origin',()=>{
    expect(allowedHostedUrl('https://gateway.example/setup/one','https://gateway.example/v1')).toBe('https://gateway.example/setup/one');
    for(const value of ['https://evil.example/setup','http://gateway.example/setup','https://user:password@gateway.example/setup','https://gateway.example/setup#secret','javascript:alert(1)'])expect(()=>allowedHostedUrl(value,'https://gateway.example')).toThrow();
  });
  it('does not mistake authorization for settled top-up evidence',()=>{
    expect(moneyOutcome.safeParse({status:'AUTHORIZED'}).success).toBe(false);
  });
  it('fails closed before database access when the runtime release is disabled',async()=>{
    const db={query:async()=>{throw new Error('must not query');}} as unknown as Database;
    await expect(createWalletMoneyPolicy(db,{LINQASEND_REAL_MONEY_ENABLED:false} as AppConfig).authorize({} as never)).rejects.toThrow('WALLET_MONEY_RELEASE_NOT_READY');
  });
});
