/**
 * Maps the wallet API's error codes (the `error` string of a non-2xx response, carried as the thrown Error's message)
 * to what a customer can do next. Codes are matched exactly, never by message text.
 *
 * Nothing here claims money was or wasn't moved. After a failed submit the screen keeps its pending-action check;
 * that, not this mapping, decides whether another action may start.
 */
export type WalletFailureAction = "LOAD" | "LINK" | "REVIEW" | "ACTIVITY";
/** `field` says which form field the problem belongs to, so a form can show it inline. */
export type WalletFailureField = "recipient" | "amount";
export type WalletFailure = { code: string | null; message: string; fix?: string; action?: WalletFailureAction; field?: WalletFailureField };

const R = (message: string, fix?: string, action?: WalletFailureAction, field?: WalletFailureField): Omit<WalletFailure, "code"> => ({ message, fix, action, field });

const FAILURES: Record<string, Omit<WalletFailure, "code">> = {
  WALLET_INSUFFICIENT_FUNDS: R("Your available balance doesn't cover the amount plus the fee.", "Load your wallet, or send a smaller amount.", "LOAD", "amount"),
  WALLET_DAILY_LIMIT_EXCEEDED: R("This would go over your daily wallet limit.", "Try a smaller amount, or try again once your daily limit has reset.", undefined, "amount"),
  WALLET_OPERATION_LIMIT_DENIED: R("This amount is above the limit for a single wallet action.", "Try a smaller amount.", undefined, "amount"),
  WALLET_QUOTE_EXPIRED_OR_NOT_OWNED: R("This quote expired.", "Review the amount again to get a new one.", "REVIEW"),
  WALLET_DESTINATION_CHANGED: R("The destination changed since you reviewed this.", "Review the details again.", "REVIEW"),
  WALLET_AUTHORIZATION_MISMATCH: R("The approval no longer matches this action.", "Review the details again.", "REVIEW"),
  IDEMPOTENCY_KEY_REUSED: R("Those details changed since your last attempt.", "Review the amount again.", "REVIEW"),
  IDEMPOTENCY_IN_PROGRESS: R("This request is still being processed.", "Don't tap again. Check your activity in a moment to see the result.", "ACTIVITY"),
  IDEMPOTENCY_UNAVAILABLE: R("Wallet requests are temporarily unavailable.", "Try again shortly."),
  WALLET_OPERATION_ALREADY_DISPATCHED: R("This action has already been sent for processing.", "Check your activity for its status.", "ACTIVITY"),
  VERIFIED_OWNED_BANK_OR_CARD_REQUIRED: R("This needs a verified bank account or debit card of yours.", "Link and verify one first.", "LINK"),
  BANK_OWNERSHIP_NOT_VERIFIED: R("This account's ownership isn't verified yet.", "Finish verification with the provider.", "LINK"),
  WALLET_EXTERNAL_DESTINATION_UNVERIFIED: R("This recipient's destination isn't verified yet.", "Choose a different recipient, or verify this one.", undefined, "recipient"),
  WALLET_EXTERNAL_DESTINATION_INVALID: R("This recipient's destination can't receive wallet payments.", "Choose a different recipient.", undefined, "recipient"),
  WALLET_INTERNAL_RECIPIENT_INVALID: R("You can't send to this recipient from your wallet.", "Choose a different recipient.", undefined, "recipient"),
  WALLET_RECIPIENT_NOT_FOUND: R("This recipient could no longer be found.", "Choose a different recipient.", undefined, "recipient"),
  WALLET_CORRIDOR_NOT_READY: R("Payments to this recipient's country aren't available yet.", undefined, undefined, "recipient"),
  WALLET_RECIPIENT_NOT_ELIGIBLE: R("This recipient can't receive wallet payments right now.", "Choose a different recipient.", undefined, "recipient"),
  RECIPIENT_WALLET_SAME_ENTITY_REQUIRED: R("This recipient doesn't have a wallet that can receive from yours.", "Choose a different recipient.", undefined, "recipient"),
  WALLET_SECURITY_COOLDOWN: R("A recent security change is limiting wallet actions for now.", "Try again later."),
  WALLET_RISK_REVIEW_REQUIRED: R("This action needs a review before it can go ahead.", "Contact support if it doesn't clear."),
  WALLET_NOT_ACTIVE: R("This wallet isn't active."),
  WALLET_MONEY_PAUSED: R("Wallet payments are paused right now.", "Try again later."),
  WALLET_ROUTE_PAUSED: R("This payment route is paused right now.", "Try again later."),
  WALLET_MONEY_RELEASE_NOT_READY: R("Wallet money movement is not enabled yet."),
  WALLET_CURRENCY_NOT_AVAILABLE: R("Linqa doesn't offer wallets in this currency in your country yet."),
  WALLET_PROFILE_REQUIRED: R("Your account country isn't verified yet.", "Finish verifying your account to open a wallet."),
  LEGACY_WALLET_RECONCILIATION_REQUIRED: R("This wallet needs a review before it can be used.", "Contact support to finish it."),
  WALLET_FEE_SCHEDULE_MISSING: R("Sending in this currency isn't available yet.")
};

/** Every code this mapping handles; a test checks each one still exists in the server source. */
export const WALLET_FAILURE_CODES: readonly string[] = Object.keys(FAILURES);

export function walletFailure(error: unknown, fallback: string): WalletFailure {
  const raw = error instanceof Error ? error.message : "";
  const known = FAILURES[raw];
  if (known) return { code: raw, ...known };
  // An unmapped server code is shown generically with the code for support; any other message (e.g. a biometric prompt) passes through.
  if (/^[A-Z][A-Z0-9_]+$/.test(raw)) return { code: raw, message: `${fallback} (${raw})` };
  return { code: null, message: raw || fallback };
}

/** Message plus its next step on one line, for screens without room for an action button. */
export function walletErrorText(error: unknown, fallback: string): string {
  const f = walletFailure(error, fallback);
  return f.fix ? `${f.message} ${f.fix}` : f.message;
}

/** A request that never reached the server (offline, DNS, timeout), as opposed to one the server answered. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
}
