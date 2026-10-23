import type { SqlClient } from '../../db/migration-runner.js';
import { countryName, currencyName, defaultCurrencyForCountry } from './wallet-currency.js';

export type WalletUnavailableReason = 'PROFILE_REQUIRED' | 'ENTITY_NOT_ACTIVE' | 'COUNTRY_NOT_SERVED' | 'DEFAULT_CURRENCY_NOT_SERVED';
export type WalletProfileView = {
  /** The country wallets are scoped to (the regulatory jurisdiction), with where it came from. Null until a profile exists. */
  country: { code: string; name: string; accountCountry: string; residenceCountry: string; source: 'VERIFIED_PROFILE' | 'ACCOUNT_COUNTRY' } | null;
  defaultCurrency: string | null;
  /** The default currency (even when not served, so the app can say why) plus every currency Linqa serves in this country. */
  currencies: Array<{ code: string; name: string; isDefault: boolean; available: boolean }>;
  serviceAvailable: boolean;
  unavailableReason: WalletUnavailableReason | null;
};
export type WalletProfileInput = {
  accountCountry: string; residenceCountry: string; walletCountry: string; residenceVerified: boolean; entityActive: boolean; servedCurrencies: string[];
};

/** Pure composition of the wallet landing data, kept separate from SQL so every rule is directly testable. */
export function composeWalletProfile(input: WalletProfileInput | null): WalletProfileView {
  if (!input) return { country: null, defaultCurrency: null, currencies: [], serviceAvailable: false, unavailableReason: 'PROFILE_REQUIRED' };
  const country = {
    code: input.walletCountry, name: countryName(input.walletCountry), accountCountry: input.accountCountry, residenceCountry: input.residenceCountry,
    source: input.residenceVerified ? 'VERIFIED_PROFILE' as const : 'ACCOUNT_COUNTRY' as const
  };
  const defaultCurrency = defaultCurrencyForCountry(input.walletCountry);
  const served = input.entityActive ? [...new Set(input.servedCurrencies)] : [];
  const codes = [...new Set([...(defaultCurrency ? [defaultCurrency] : []), ...served.sort()])];
  const currencies = codes.map((code) => ({ code, name: currencyName(code), isDefault: code === defaultCurrency, available: served.includes(code) }));
  const serviceAvailable = served.length > 0;
  const unavailableReason: WalletUnavailableReason | null = !input.entityActive ? 'ENTITY_NOT_ACTIVE'
    : !serviceAvailable ? 'COUNTRY_NOT_SERVED'
    : defaultCurrency && !served.includes(defaultCurrency) ? 'DEFAULT_CURRENCY_NOT_SERVED' : null;
  return { country, defaultCurrency, currencies, serviceAvailable, unavailableReason };
}

/** Wallet service exists for a country/currency only where an active corridor serves it, as a source or a destination. */
const SERVED_SQL = `SELECT DISTINCT trim(c) AS currency FROM (
  SELECT source_currency AS c FROM linqasend_corridors WHERE active AND source_country=$1
  UNION ALL SELECT destination_currency FROM linqasend_corridors WHERE active AND destination_country=$1) s`;

export class WalletAvailabilityService {
  constructor(private readonly db: SqlClient) {}

  async servedCurrencies(country: string, q: SqlClient = this.db): Promise<string[]> {
    return (await q.query(SERVED_SQL, [country.trim()])).rows.map((r) => r.currency as string);
  }

  /** Fail closed: no active corridor for this country and currency means no new wallet and no new money movement. */
  async assertServed(q: SqlClient, country: string, currency: string): Promise<void> {
    if (!(await this.servedCurrencies(country, q)).includes(currency.trim())) throw new Error('WALLET_CURRENCY_NOT_AVAILABLE');
  }

  async profile(userId: string): Promise<WalletProfileView> {
    const row = (await this.db.query(
      `SELECT p.account_country, p.verified_residence_country, p.regulatory_jurisdiction, p.residence_verified_at IS NOT NULL AS residence_verified,
              (e.status='ACTIVE' AND e.due_diligence_status='APPROVED') AS entity_active
       FROM user_jurisdiction_profiles_v2 p JOIN users u ON u.id=p.user_id AND u.status='ACTIVE'
       LEFT JOIN linqasend_financial_entities_v7 e ON e.id=p.regulatory_entity_id WHERE p.user_id=$1`, [userId])).rows[0];
    if (!row) return composeWalletProfile(null);
    const walletCountry = String(row.regulatory_jurisdiction).trim();
    return composeWalletProfile({
      accountCountry: String(row.account_country).trim(), residenceCountry: String(row.verified_residence_country).trim(), walletCountry,
      residenceVerified: row.residence_verified === true, entityActive: row.entity_active === true, servedCurrencies: await this.servedCurrencies(walletCountry)
    });
  }
}
