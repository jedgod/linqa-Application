export type PaymentMethod = "CARD" | "APPLE_PAY" | "GOOGLE_PAY" | "PAYPAL";
export type CheckoutState = "CREATED" | "CANCELED" | "FAILED" | "SUCCEEDED";

export type PlanCard = { code: "FREE" | "PREMIUM" | "ELITE"; name: string; reach: string; monthlyPriceMinor: number; currency: string; features: string[] };
export type PlansResponse = {
  current: { tier: "FREE" | "PREMIUM" | "ELITE"; status: string; provider: string | null; currentPeriodEnd: string | null };
  paymentsAvailable: boolean;
  methods: PaymentMethod[];
  plans: PlanCard[];
};
export type Checkout = { id: string; planCode: string; method: PaymentMethod; amountMinor: number; currency: string; state: CheckoutState; failureCode: string | null; checkoutUrl: string | null };

const RANK = { FREE: 0, PREMIUM: 1, ELITE: 2 } as const;

/** "$4.99" and, with `perMonth`, "$4.99 / month". Free is "$0". */
export function formatPrice(minor: number, currency: string, perMonth = false): string {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const whole = Math.floor(minor / 100);
  const cents = String(minor % 100).padStart(2, "0");
  const amount = minor === 0 ? `${symbol}0` : `${symbol}${whole}.${cents}`;
  return perMonth && minor > 0 ? `${amount} / month` : amount;
}

/** Plans the user can move to: only steps up from where they are. */
export function canChoose(current: PlansResponse["current"]["tier"], plan: PlanCard["code"]): boolean {
  return RANK[plan] > RANK[current];
}

export const METHODS: Array<{ key: PaymentMethod; label: string; icon: "card-outline" | "logo-apple" | "logo-google" | "logo-paypal" }> = [
  { key: "CARD", label: "Credit / Debit Card", icon: "card-outline" },
  { key: "APPLE_PAY", label: "Apple Pay", icon: "logo-apple" },
  { key: "GOOGLE_PAY", label: "Google Pay", icon: "logo-google" },
  { key: "PAYPAL", label: "PayPal", icon: "logo-paypal" }
];

/**
 * Whether a payment method can be used here. Card and PayPal go through the provider's payment page.
 * Apple Pay and Google Pay need the phone's own pay sheet, which this version of the app does not have,
 * so they are shown but turned off, and each says why.
 */
export function methodAvailability(method: PaymentMethod, os: string, serverMethods: PaymentMethod[]): { available: boolean; reason: string | null } {
  if (!serverMethods.includes(method)) return { available: false, reason: "Not offered yet" };
  if (method === "APPLE_PAY") return { available: false, reason: os === "ios" ? "Not available in this version" : "Only on iPhone" };
  if (method === "GOOGLE_PAY") return { available: false, reason: os === "android" ? "Not available in this version" : "Only on Android" };
  return { available: true, reason: null };
}

export type ResultKind = "SUCCESS" | "CANCELED" | "FAILED" | "PENDING";

/** What the result screen shows for an attempt. Anything not finished is still pending. */
export function resultOf(checkout: Pick<Checkout, "state">): ResultKind {
  if (checkout.state === "SUCCEEDED") return "SUCCESS";
  if (checkout.state === "CANCELED") return "CANCELED";
  if (checkout.state === "FAILED") return "FAILED";
  return "PENDING";
}

const FAILURE_TEXT: Record<string, string> = {
  PAYMENT_NOT_CONFIGURED: "Payments are not available yet. You have not been charged.",
  METHOD_NOT_AVAILABLE: "That payment method is not available. Choose another.",
  PAYMENT_START_FAILED: "We could not start the payment. You have not been charged."
};
export const failureMessage = (code: string | null) => (code && FAILURE_TEXT[code]) || "Please try again or use a different payment method.";

/**
 * Where "Continue" goes after a payment: back to the screen the person started from, but only to a
 * screen inside this app. Anything else (a web address, another scheme) falls back.
 */
export function safeReturn(from: string | undefined, fallback = "/countrylinqa/plan"): string {
  if (!from || !from.startsWith("/") || from.startsWith("//") || from.includes("://") || from.includes("..") || from.length > 200) return fallback;
  return /^\/(countrylinqa|settings)(\/|\?|$)/.test(from) ? from : fallback;
}

/** The server reads this as the person's plan being active. The app only asks again until it changes. */
export const POLL_MS = 3000;
export const POLL_LIMIT = 100;

/** A payment page is only ever opened when it is a plain https address (never another app's scheme, never http). */
export function isSafeCheckoutUrl(url: string | null | undefined): url is string {
  if (!url || url.length > 2000) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".");
  } catch { return false; }
}
