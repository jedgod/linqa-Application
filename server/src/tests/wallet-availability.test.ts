import { describe, expect, it } from 'vitest';
import { composeWalletProfile, type WalletProfileInput } from '../services/linqasend/wallet-availability.service.js';
import { defaultCurrencyForCountry } from '../services/linqasend/wallet-currency.js';

const input = (over: Partial<WalletProfileInput> = {}): WalletProfileInput => ({
  accountCountry: 'GH', residenceCountry: 'GH', walletCountry: 'GH', residenceVerified: true, entityActive: true, servedCurrencies: ['GHS'], ...over
});

describe('country to default currency (maintained catalogue)', () => {
  it('maps countries across the catalogue, case-insensitively', () => {
    expect(defaultCurrencyForCountry('US')).toBe('USD');
    expect(defaultCurrencyForCountry('GH')).toBe('GHS');
    expect(defaultCurrencyForCountry('gb')).toBe('GBP');
    expect(defaultCurrencyForCountry('DE')).toBe('EUR');
    expect(defaultCurrencyForCountry('SN')).toBe('XOF');
    expect(defaultCurrencyForCountry('JP')).toBe('JPY');
  });
  it('returns null for anything that is not a catalogued two-letter code, never a guess', () => {
    for (const bad of ['', 'ZZ', 'USA', 'U', '1A', '  ']) expect(defaultCurrencyForCountry(bad)).toBeNull();
  });
});

describe('wallet landing profile', () => {
  it('has no country and no service until a jurisdiction profile exists', () => {
    expect(composeWalletProfile(null)).toEqual({ country: null, defaultCurrency: null, currencies: [], serviceAvailable: false, unavailableReason: 'PROFILE_REQUIRED' });
  });

  it("offers the country's default currency first, then other served currencies", () => {
    const p = composeWalletProfile(input({ servedCurrencies: ['USD', 'GHS', 'USD'] }));
    expect(p.country).toMatchObject({ code: 'GH', name: 'Ghana', source: 'VERIFIED_PROFILE' });
    expect(p.defaultCurrency).toBe('GHS');
    expect(p.currencies.map((c) => [c.code, c.isDefault, c.available])).toEqual([['GHS', true, true], ['USD', false, true]]);
    expect(p).toMatchObject({ serviceAvailable: true, unavailableReason: null });
  });

  it('says the country came from the account when residence is not verified', () => {
    expect(composeWalletProfile(input({ residenceVerified: false })).country?.source).toBe('ACCOUNT_COUNTRY');
  });

  it('recognizes a country Linqa does not serve, and keeps its currency visible but unavailable', () => {
    const p = composeWalletProfile(input({ servedCurrencies: [] }));
    expect(p.country?.name).toBe('Ghana');
    expect(p.currencies).toEqual([{ code: 'GHS', name: 'Ghanaian Cedi', isDefault: true, available: false }]);
    expect(p).toMatchObject({ serviceAvailable: false, unavailableReason: 'COUNTRY_NOT_SERVED' });
  });

  it('flags a served country whose own currency is not served, while other currencies stay available', () => {
    const p = composeWalletProfile(input({ servedCurrencies: ['USD'] }));
    expect(p.currencies.map((c) => [c.code, c.available])).toEqual([['GHS', false], ['USD', true]]);
    expect(p).toMatchObject({ serviceAvailable: true, unavailableReason: 'DEFAULT_CURRENCY_NOT_SERVED' });
  });

  it('is unavailable when the regulatory entity is not active, whatever the corridors say', () => {
    const p = composeWalletProfile(input({ entityActive: false, servedCurrencies: ['GHS', 'USD'] }));
    expect(p.currencies.every((c) => !c.available)).toBe(true);
    expect(p).toMatchObject({ serviceAvailable: false, unavailableReason: 'ENTITY_NOT_ACTIVE' });
  });

  it('copes with a country missing from the catalogue', () => {
    const p = composeWalletProfile(input({ walletCountry: 'ZZ', servedCurrencies: ['USD'] }));
    expect(p.defaultCurrency).toBeNull();
    expect(p.currencies.map((c) => c.code)).toEqual(['USD']);
    expect(p.serviceAvailable).toBe(true);
  });
});
