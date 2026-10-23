/** An error response from the wallet API: `message` is the server's error code (e.g. WALLET_INSUFFICIENT_FUNDS). */
export class WalletApiError extends Error {
  constructor(message: string, readonly payload: Record<string, unknown>, readonly status: number) { super(message); }
}
