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

export type TokenizerSession = { setupToken: string; clientSecret: string; cardEndpoint?: string };

export type CvvTokenizerSession = { clientSecret: string; cvvEndpoint?: string };

export interface CardTokenizer {
  /** Sends the card straight to the provider using the setup session's client secret. */
  submit(session: TokenizerSession, card: CardDetails): Promise<void>;
  /** Sends the security code the sender typed for this payment straight to the provider. It never reaches LinqaSend. */
  submitCvv(session: CvvTokenizerSession, cvv: string): Promise<void>;
}

/**
 * Development sandbox only. The Linqa API hands back a loopback `cardEndpoint` (the local sandbox
 * provider, reached over the USB tunnel) only when its own config enables LINQASEND_DEV_SANDBOX.
 * This tokenizer refuses any other destination, so card details can never go to a remote host.
 */
export function isLoopbackCardEndpoint(endpoint: string): boolean {
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/cards\/seti_[a-f0-9]+$/i.test(endpoint);
}

export function isLoopbackCvvEndpoint(endpoint: string): boolean {
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/cvv\/cvvs_[a-f0-9]+$/i.test(endpoint);
}

const devSandboxTokenizer: CardTokenizer = {
  async submitCvv(session, cvv) {
    if (!session.cvvEndpoint || !isLoopbackCvvEndpoint(session.cvvEndpoint)) throw new Error("card_provider_not_available");
    const response = await fetch(session.cvvEndpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${session.clientSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ cvv })
    });
    if (!response.ok) {
      const code = await response.json().then((b: { error?: string }) => b.error).catch(() => undefined);
      throw new Error(code ?? "card_provider_rejected");
    }
  },
  async submit(session, card) {
    if (!session.cardEndpoint || !isLoopbackCardEndpoint(session.cardEndpoint)) throw new Error("card_provider_not_available");
    const response = await fetch(session.cardEndpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${session.clientSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ number: card.number, expMonth: card.expMonth, expYear: card.expYear, cvv: card.cvv })
    });
    if (!response.ok) {
      const code = await response.json().then((b: { error?: string }) => b.error).catch(() => undefined);
      throw new Error(code ?? "card_provider_rejected");
    }
  }
};

export function getCardTokenizer(): CardTokenizer | null {
  return __DEV__ ? devSandboxTokenizer : null;
}
