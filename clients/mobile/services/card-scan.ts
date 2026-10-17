/**
 * Auto-scan for the Add New Card form, using the on-device BlinkCard module (modules/linqa-blinkcard).
 *
 * The camera and recognition run entirely on the phone. The result goes straight into the form's state and from there only to the
 * card provider's tokenizer (card-tokenizer.ts), exactly like typed details. The security code is never taken from the scan.
 *
 * The module is optional at runtime: builds that don't include it (Expo Go, web, an older installed app) report
 * "unavailable" and the form simply keeps working by hand.
 */
import { blinkCardModule, scanCard } from "../modules/linqa-blinkcard";
import { interpretScan, type CardScanOutcome } from "./card-scan-parse";

/** BlinkCard licenses are bound to the app id and are designed to ship inside the app. Expo inlines EXPO_PUBLIC_* at build time. */
const LICENSE_KEY = process.env.EXPO_PUBLIC_BLINKCARD_LICENSE_KEY?.trim() ?? "";

export function cardScanSupport(): "ready" | "NOT_IN_BUILD" | "LICENSE_MISSING" {
  if (!blinkCardModule()) return "NOT_IN_BUILD";
  return LICENSE_KEY ? "ready" : "LICENSE_MISSING";
}

/** Opens the scanner and returns what the form may prefill (or why not). Never throws and never logs card data. */
export async function scanCardForForm(): Promise<CardScanOutcome> {
  const support = cardScanSupport();
  if (support !== "ready") return { status: "unavailable", reason: support };
  try {
    const outcome = await scanCard(LICENSE_KEY);
    if (outcome.status === "canceled") return { status: "canceled" };
    return interpretScan(outcome.card);
  } catch (cause) {
    // Development only, and only the machine-readable error code: never the message text or any card data.
    // The native message is just the SDK's status name (for example "Card scanner could not start (ErrorInvalidLicense)").
    if (__DEV__) console.warn("card scan failed:", (cause as { code?: unknown } | null)?.code ?? "UNKNOWN", String((cause as { message?: unknown } | null)?.message ?? "").slice(0, 120));
    const code = String((cause as { code?: unknown } | null)?.code ?? "");
    return { status: "failed", reason: code.startsWith("BLINKCARD_") && code.includes("LICENSE") ? "LICENSE_INVALID" : "SCANNER_ERROR" };
  }
}
