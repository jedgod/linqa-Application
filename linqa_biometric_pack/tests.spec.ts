import { describe,it,expect } from 'vitest';
import { resourceHash,signingPayload } from './canonical';

describe('biometric binding',()=>{
  it('changes hash if payment amount changes',()=>{
    const a=resourceHash({transferId:'t1',amountMinor:'1000',currency:'USD',recipientId:'r1'});
    const b=resourceHash({transferId:'t1',amountMinor:'1001',currency:'USD',recipientId:'r1'});
    expect(a.equals(b)).toBe(false);
  });
  it('binds signature to purpose',()=>{
    const base={challengeId:'c',challenge:'x',resourceHashHex:'00',userId:'u',deviceId:'d'};
    expect(signingPayload({...base,purpose:'VAULT_UNLOCK'}).equals(
      signingPayload({...base,purpose:'SEND_TRANSFER_AUTHORIZE'}))).toBe(false);
  });
});
