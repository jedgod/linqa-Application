import countryToCurrency from 'country-to-currency';

/**
 * ISO 3166-1 alpha-2 country -> default ISO 4217 currency, from the maintained `country-to-currency` catalogue.
 * The catalogue only says which currency a country uses. Whether Linqa serves a wallet there is decided separately, by
 * active service corridors (see wallet-availability.service.ts).
 */
const CATALOGUE: Readonly<Record<string, string>> = countryToCurrency;

export function defaultCurrencyForCountry(country: string): string | null {
  const code = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? CATALOGUE[code] ?? null : null;
}

/** Display names come from the platform's ICU data; an unknown code falls back to the code itself, never to a guess. */
export function countryName(code: string, locale = 'en'): string {
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase()) ?? code; } catch { return code; }
}
export function currencyName(code: string, locale = 'en'): string {
  try { return new Intl.DisplayNames([locale], { type: 'currency' }).of(code.toUpperCase()) ?? code; } catch { return code; }
}
