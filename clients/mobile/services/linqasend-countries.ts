/**
 * Destination countries offered when adding a recipient: name, receiving currency and dialing
 * code. This only fills in the form. Whether a corridor to a country is actually open is decided
 * by the server when the recipient is saved and when a quote is requested.
 */
export type SendCountry = { code: string; name: string; currency: string; dial: string; methods: Array<"MOBILE_MONEY" | "BANK"> };

export const SEND_COUNTRIES: readonly SendCountry[] = [
  { code: "GH", name: "Ghana", currency: "GHS", dial: "233", methods: ["MOBILE_MONEY", "BANK"] },
  { code: "NG", name: "Nigeria", currency: "NGN", dial: "234", methods: ["BANK", "MOBILE_MONEY"] },
  { code: "KE", name: "Kenya", currency: "KES", dial: "254", methods: ["MOBILE_MONEY", "BANK"] },
  { code: "UG", name: "Uganda", currency: "UGX", dial: "256", methods: ["MOBILE_MONEY", "BANK"] },
  { code: "TZ", name: "Tanzania", currency: "TZS", dial: "255", methods: ["MOBILE_MONEY", "BANK"] },
  { code: "RW", name: "Rwanda", currency: "RWF", dial: "250", methods: ["MOBILE_MONEY", "BANK"] },
  { code: "ZA", name: "South Africa", currency: "ZAR", dial: "27", methods: ["BANK"] },
  { code: "SN", name: "Senegal", currency: "XOF", dial: "221", methods: ["MOBILE_MONEY", "BANK"] },
  { code: "CI", name: "Côte d'Ivoire", currency: "XOF", dial: "225", methods: ["MOBILE_MONEY", "BANK"] },
  { code: "CM", name: "Cameroon", currency: "XAF", dial: "237", methods: ["MOBILE_MONEY", "BANK"] },
  { code: "ET", name: "Ethiopia", currency: "ETB", dial: "251", methods: ["BANK", "MOBILE_MONEY"] },
  { code: "EG", name: "Egypt", currency: "EGP", dial: "20", methods: ["BANK"] },
  { code: "MA", name: "Morocco", currency: "MAD", dial: "212", methods: ["BANK"] },
  { code: "US", name: "United States", currency: "USD", dial: "1", methods: ["BANK"] },
  { code: "CA", name: "Canada", currency: "CAD", dial: "1", methods: ["BANK"] },
  { code: "GB", name: "United Kingdom", currency: "GBP", dial: "44", methods: ["BANK"] },
  { code: "DE", name: "Germany", currency: "EUR", dial: "49", methods: ["BANK"] },
  { code: "FR", name: "France", currency: "EUR", dial: "33", methods: ["BANK"] },
  { code: "ES", name: "Spain", currency: "EUR", dial: "34", methods: ["BANK"] },
  { code: "IT", name: "Italy", currency: "EUR", dial: "39", methods: ["BANK"] },
  { code: "IN", name: "India", currency: "INR", dial: "91", methods: ["BANK"] },
  { code: "PK", name: "Pakistan", currency: "PKR", dial: "92", methods: ["BANK", "MOBILE_MONEY"] },
  { code: "BD", name: "Bangladesh", currency: "BDT", dial: "880", methods: ["BANK", "MOBILE_MONEY"] },
  { code: "PH", name: "Philippines", currency: "PHP", dial: "63", methods: ["BANK", "MOBILE_MONEY"] },
  { code: "MX", name: "Mexico", currency: "MXN", dial: "52", methods: ["BANK"] },
  { code: "BR", name: "Brazil", currency: "BRL", dial: "55", methods: ["BANK"] },
  { code: "JM", name: "Jamaica", currency: "JMD", dial: "1", methods: ["BANK"] }
];

export function findCountry(code: string | null | undefined): SendCountry | undefined {
  return SEND_COUNTRIES.find((country) => country.code === (code ?? "").toUpperCase());
}

export const METHOD_LABEL = { MOBILE_MONEY: "Mobile Money", BANK: "Bank account" } as const;

/**
 * Normalizes a typed phone number to E.164 for the chosen country, or returns null if it cannot be a
 * phone number. "+233 24 123 4567" and "024 123 4567" (with Ghana selected) both become +233241234567.
 */
export function normalizePhone(input: string, dial: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  let national: string;
  if (trimmed.startsWith("+")) {
    if (!digits.startsWith(dial)) return null;
    national = digits.slice(dial.length);
  } else if (digits.startsWith("00" + dial)) {
    national = digits.slice(2 + dial.length);
  } else {
    national = digits.replace(/^0+/, "");
    if (national.startsWith(dial) && national.length > 10) national = national.slice(dial.length);
  }
  if (national.length < 6 || national.length > 12) return null;
  return `+${dial}${national}`;
}
