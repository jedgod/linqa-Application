/**
 * The only place card details may go: a PCI-certified payment provider's own tokenizer.
 *
 * Card numbers and security codes must never reach LinqaSend's servers or logs. The server hands
 * the app a short-lived `clientSecret` for a setup session (`POST /v1/linqasend/payment-methods/setup`);
 * the provider's SDK sends the card details straight to the provider with that secret and returns
 * nothing sensitive. The app then asks the server to confirm the setup token.
 *
 * No provider SDK is integrated yet, so `getCardTokenizer()` returns null and the Add New Card
 * screen refuses to submit instead of sending card data anywhere else. When a provider is chosen,
 * implement `CardTokenizer` with its SDK and return it here; nothing else changes.
 */
export type CardDetails = { number: string; expMonth: number; expYear: number; cvv: string; holderName: string; billingAddress: string };

export interface CardTokenizer {
  /** Sends the card straight to the provider using the setup session's client secret. */
  submit(session: { setupToken: string; clientSecret: string }, card: CardDetails): Promise<void>;
}

export function getCardTokenizer(): CardTokenizer | null {
  return null;
}
