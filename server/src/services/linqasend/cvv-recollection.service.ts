import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../config.js";
import type { Database } from "../../db/pool.js";
import { devSandboxCardProvider } from "./dev-sandbox.js";

export const CARD_FUNDING_TYPES = ["DEBIT_CARD", "CREDIT_CARD"] as const;
export const CVV_SESSION_TTL_SECONDS = 300;

export type CardProviderEndpoint = { url: string; token: string };

/** The card provider the server talks to: the configured partner, or the development sandbox provider. */
export function resolveCardProvider(config: AppConfig): CardProviderEndpoint | null {
  if (config.LINQASEND_PROVIDER_URL && config.LINQASEND_PROVIDER_TOKEN) return { url: config.LINQASEND_PROVIDER_URL, token: config.LINQASEND_PROVIDER_TOKEN };
  return devSandboxCardProvider(config);
}

export class CvvError extends Error {
  constructor(readonly code: "cvv_required" | "cvv_invalid" | "cvv_provider_not_configured") { super(code); }
}

/**
 * Card security-code recollection. The sender types the code on the phone for every card-funded
 * payment; the phone posts it directly to the provider with a one-time client secret. This service
 * only creates the provider session and later consumes it exactly once, so the code never touches
 * LinqaSend's servers, logs or database.
 */
export class CvvRecollectionService {
  constructor(private readonly db: Database, private readonly provider: CardProviderEndpoint | null) {}

  private async call(path: string, body: unknown): Promise<Response> {
    if (!this.provider) throw new CvvError("cvv_provider_not_configured");
    return fetch(`${this.provider.url.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.provider.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    });
  }

  async createSession(input: { userId: string; paymentMethodId: string; providerPaymentMethodRef: string }) {
    const response = await this.call("/cvv-sessions", { userId: input.userId, paymentMethodRef: input.providerPaymentMethodRef });
    if (!response.ok) throw new Error(`CVV_PROVIDER_ERROR:${response.status}`);
    const session = (await response.json()) as { sessionId?: string; clientSecret?: string; cvvEndpoint?: string };
    if (!session.sessionId || !session.clientSecret) throw new Error("CVV_PROVIDER_BAD_RESPONSE");
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + CVV_SESSION_TTL_SECONDS * 1000);
    await this.db.query(
      `INSERT INTO linqasend_cvv_sessions(id,user_id,payment_method_id,provider_session_ref,expires_at) VALUES($1,$2,$3,$4,$5)`,
      [id, input.userId, input.paymentMethodId, session.sessionId, expiresAt]
    );
    return { cvvSessionId: id, clientSecret: session.clientSecret, ...(session.cvvEndpoint ? { cvvEndpoint: session.cvvEndpoint } : {}), expiresAt: expiresAt.toISOString() };
  }

  /** Spend the proof for one payment. Throws unless the sender typed the code for this card, recently, once. */
  async consume(input: { userId: string; paymentMethodId: string; cvvSessionId: string }): Promise<void> {
    if (!this.provider) throw new CvvError("cvv_provider_not_configured");
    const reserved = await this.db.query(
      `UPDATE linqasend_cvv_sessions SET status='CONSUMED',consumed_at=now()
       WHERE id=$1 AND user_id=$2 AND payment_method_id=$3 AND status='PENDING' AND expires_at>now() RETURNING provider_session_ref`,
      [input.cvvSessionId, input.userId, input.paymentMethodId]
    );
    const providerSession = reserved.rows[0]?.provider_session_ref as string | undefined;
    if (!providerSession) throw new CvvError("cvv_invalid");
    let accepted = false;
    try {
      const response = await this.call("/cvv-sessions/consume", { userId: input.userId, sessionId: providerSession });
      accepted = response.ok;
    } finally {
      if (!accepted) await this.db.query(`UPDATE linqasend_cvv_sessions SET status='PENDING',consumed_at=NULL WHERE id=$1`, [input.cvvSessionId]);
    }
    if (!accepted) throw new CvvError("cvv_required");
  }
}
