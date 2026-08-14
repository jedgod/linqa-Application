import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAuthenticator, requireScope } from "../../auth/jwt.js";
import type { Database } from "../../db/pool.js";
import type { LinqaSendProviders } from "../../integrations/linqasend/provider.contracts.js";
import { getLinqaSendProviders } from "../../integrations/linqasend/provider.registry.js";
import { reconcileInFlightTransfers } from "../../integrations/linqasend/reconciliation.js";
import { verifyLinqaSendWebhookSignature } from "../../integrations/linqasend/webhook-verifier.js";
import { FxPricingService } from "../../services/linqasend/fx-pricing.service.js";
import { FxRateRepository } from "../../services/linqasend/fx-rate.repository.js";
import { LedgerService } from "../../services/linqasend/ledger.service.js";
import { QuoteService } from "../../services/linqasend/quote.service.js";
import { RecipientResolverService } from "../../services/linqasend/recipient-resolver.service.js";
import { RiskEngineService } from "../../services/linqasend/risk-engine.service.js";
import { TransferOrchestratorService } from "../../services/linqasend/transfer-orchestrator.service.js";

function withErrors<T>(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: "validation_error", details: error.flatten() });
      }
      request.log.warn({ err: error }, "linqasend request rejected");
      return reply.code(400).send({ error: typeof error?.message === "string" ? error.message : "invalid_request" });
    }
  };
}

const createRecipientSchema = z.object({
  query: z.string().trim().min(3).max(320)
});

const createQuoteSchema = z.object({
  recipientId: z.string().uuid(),
  sourceCountry: z.string().length(2),
  destinationCountry: z.string().length(2),
  sourceCurrency: z.string().length(3),
  destinationCurrency: z.string().length(3),
  paymentMethodId: z.string().uuid().optional(),
  sendAmountMinor: z.string().regex(/^\d+$/)
});

const createTransferSchema = z.object({
  quoteId: z.string().uuid(),
  paymentMethodId: z.string().uuid(),
  purposeCode: z.string().max(64).optional(),
  senderLegalName: z.string().min(1).max(160),
  senderCountry: z.string().length(2),
  stepUpVerified: z.boolean().default(false)
});

/**
 * Real Fastify integration of the LinqaSend pack, adapted into this
 * repository's single server instead of the pack's separate NestJS
 * `apps/api`. The pricing, risk, transfer-state-machine, and ledger logic
 * is genuinely implemented (see `services/linqasend/*`); only the final
 * payment-provider funding/payout call fails closed, because no licensed
 * payment/remittance partner is configured in this environment — exactly
 * the same convention as calls, push, and attachments elsewhere here.
 */
export async function registerLinqaSendRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  providers: LinqaSendProviders = getLinqaSendProviders()
) {
  const authenticate = createAuthenticator(config);
  const fxPricing = new FxPricingService();
  const fxRates = new FxRateRepository(db);
  const quotes = new QuoteService(db, fxPricing, fxRates);
  const recipients = new RecipientResolverService(db);
  const risk = new RiskEngineService();
  const ledger = new LedgerService(db);
  const orchestrator = new TransferOrchestratorService(db, risk, ledger, providers);

  /**
   * Real funding-source registration by opaque reference — not a PCI card
   * tokenization flow (no PCI-capable provider SDK is integrated here, per
   * the pack's own rule #1: never store PAN/CVV/PIN/track data). A bank
   * account reference is safe to store as-is; a real card-add flow needs a
   * real provider's hosted tokenization session plugged in before it can
   * exist honestly.
   */
  app.post(
    "/v1/linqasend/payment-methods",
    withErrors(async (request, reply) => {
      const p = await authenticate(request);
      requireScope(p, "linqasend:write");
      const body = z
        .object({
          type: z.enum(["BANK_ACCOUNT", "MOBILE_WALLET"]),
          reference: z.string().trim().min(4).max(255),
          last4: z.string().length(4).optional(),
          billingCountry: z.string().length(2).optional()
        })
        .parse(request.body);

      const id = randomUUID();
      await db.query(
        `INSERT INTO linqasend_payment_methods(id, user_id, provider, provider_payment_method_ref, type, last4, billing_country, verification_status)
         VALUES ($1,$2,'manual-reference',$3,$4,$5,$6,'VERIFIED')`,
        [id, p.userId, body.reference, body.type, body.last4 ?? null, body.billingCountry ?? null]
      );
      return reply.code(201).send({ id, type: body.type, last4: body.last4 ?? null });
    })
  );

  app.get(
    "/v1/linqasend/payment-methods",
    withErrors(async (request) => {
      const p = await authenticate(request);
      requireScope(p, "linqasend:read");
      const { rows } = await db.query(
        `SELECT id, type, last4, billing_country, verification_status, created_at
         FROM linqasend_payment_methods WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [p.userId]
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          type: r.type,
          last4: r.last4,
          billingCountry: r.billing_country,
          verificationStatus: r.verification_status,
          createdAt: r.created_at
        }))
      };
    })
  );

  app.post(
    "/v1/linqasend/recipients",
    withErrors(async (request, reply) => {
      const p = await authenticate(request);
      requireScope(p, "linqasend:write");
      const body = createRecipientSchema.parse(request.body);

      const resolved = await recipients.resolveLinqaUser(body.query);
      if (!resolved) return reply.code(404).send({ error: "recipient_not_found" });
      if (resolved.userId === p.userId) return reply.code(400).send({ error: "cannot_add_self" });

      const existing = await db.query(
        `SELECT id FROM linqasend_recipients WHERE owner_user_id = $1 AND linqa_user_id = $2`,
        [p.userId, resolved.userId]
      );
      if (existing.rows[0]) {
        return reply.code(200).send({ id: existing.rows[0].id, displayName: resolved.displayName });
      }

      const id = randomUUID();
      await db.query(
        `INSERT INTO linqasend_recipients(id, owner_user_id, recipient_type, linqa_user_id, display_name, country, preferred_currency)
         VALUES ($1,$2,'LINQA_USER',$3,$4,'US','USD')`,
        [id, p.userId, resolved.userId, resolved.displayName]
      );
      return reply.code(201).send({ id, displayName: resolved.displayName });
    })
  );

  app.get(
    "/v1/linqasend/recipients",
    withErrors(async (request) => {
      const p = await authenticate(request);
      requireScope(p, "linqasend:read");
      const { rows } = await db.query(
        `SELECT id, display_name, country, preferred_currency, is_favorite, created_at
         FROM linqasend_recipients WHERE owner_user_id = $1 ORDER BY is_favorite DESC, created_at DESC`,
        [p.userId]
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          displayName: r.display_name,
          country: r.country,
          preferredCurrency: r.preferred_currency,
          isFavorite: r.is_favorite,
          createdAt: r.created_at
        }))
      };
    })
  );

  app.get(
    "/v1/linqasend/corridors",
    withErrors(async (request) => {
      const p = await authenticate(request);
      requireScope(p, "linqasend:read");
      const query = z
        .object({
          sourceCountry: z.string().length(2),
          destinationCountry: z.string().length(2),
          sourceCurrency: z.string().length(3),
          destinationCurrency: z.string().length(3)
        })
        .parse(request.query);
      const corridor = await quotes.findCorridor(
        query.sourceCountry,
        query.destinationCountry,
        query.sourceCurrency,
        query.destinationCurrency
      );
      return {
        id: corridor.id,
        minAmountMinor: corridor.min_amount_minor,
        maxAmountMinor: corridor.max_amount_minor,
        provider: corridor.provider,
        estimatedDeliveryText: (corridor as any).estimated_delivery_text ?? null
      };
    })
  );

  app.post(
    "/v1/linqasend/quotes",
    withErrors(async (request) => {
      const p = await authenticate(request);
      requireScope(p, "linqasend:write");
      const body = createQuoteSchema.parse(request.body);

      const recipientRow = await db.query(
        `SELECT id FROM linqasend_recipients WHERE id = $1 AND owner_user_id = $2`,
        [body.recipientId, p.userId]
      );
      if (!recipientRow.rows[0]) throw new Error("recipient_not_found");

      const corridor = await quotes.findCorridor(
        body.sourceCountry,
        body.destinationCountry,
        body.sourceCurrency,
        body.destinationCurrency
      );

      return quotes.createQuote({
        userId: p.userId,
        recipientId: body.recipientId,
        corridor,
        paymentMethodId: body.paymentMethodId,
        sendAmountMinor: BigInt(body.sendAmountMinor)
      });
    })
  );

  app.post(
    "/v1/linqasend/transfers",
    withErrors(async (request, reply) => {
      const p = await authenticate(request);
      requireScope(p, "linqasend:write");
      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16) {
        return reply.code(400).send({ error: "valid_idempotency_key_required" });
      }
      const body = createTransferSchema.parse(request.body);

      const quote = await quotes.getActiveQuote(p.userId, body.quoteId);
      const recipientRow = await db.query(
        `SELECT id, display_name, country FROM linqasend_recipients WHERE id = $1 AND owner_user_id = $2`,
        [quote.recipient_id, p.userId]
      );
      if (!recipientRow.rows[0]) return reply.code(404).send({ error: "recipient_not_found" });
      const recipient = recipientRow.rows[0];

      const priorTransfers = await db.query(
        `SELECT count(*)::int AS count, coalesce(sum(send_amount_minor),0)::bigint AS total
         FROM linqasend_transfers WHERE user_id = $1 AND created_at > now() - interval '24 hours'`,
        [p.userId]
      );
      const priorWithRecipient = await db.query(
        `SELECT count(*)::int AS count FROM linqasend_transfers WHERE user_id = $1 AND recipient_id = $2`,
        [p.userId, recipient.id]
      );

      const result = await orchestrator.createTransfer({
        userId: p.userId,
        quote: {
          id: quote.id,
          recipientId: quote.recipient_id,
          sendAmountMinor: String(quote.send_amount_minor),
          sendCurrency: quote.send_currency,
          receiveAmountMinor: String(quote.receive_amount_minor),
          receiveCurrency: quote.receive_currency,
          customerRate: String(quote.customer_rate),
          marginBps: quote.margin_bps,
          provider: quote.provider
        },
        recipient: { id: recipient.id, displayName: recipient.display_name, country: recipient.country },
        paymentMethodId: body.paymentMethodId,
        idempotencyKey,
        purposeCode: body.purposeCode,
        senderLegalName: body.senderLegalName,
        senderCountry: body.senderCountry,
        authContext: {
          stepUpVerified: body.stepUpVerified,
          deviceTrusted: Boolean(p.deviceId),
          accountAgeDays: 30,
          recentPasswordReset: false,
          recentSimChange: false,
          velocity24hMinor: BigInt(priorTransfers.rows[0]?.total ?? 0),
          isNewRecipient: (priorWithRecipient.rows[0]?.count ?? 0) === 0,
          isNewPaymentMethod: false,
          countryRiskScore: 0
        }
      });

      return reply.code(202).send(result);
    })
  );

  app.get(
    "/v1/linqasend/transfers",
    withErrors(async (request) => {
      const p = await authenticate(request);
      requireScope(p, "linqasend:read");
      const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
      const { rows } = await db.query(
        `SELECT t.public_id, t.status, t.send_amount_minor, t.send_currency,
                t.receive_amount_minor, t.receive_currency, t.created_at, t.completed_at,
                r.display_name AS recipient_name
         FROM linqasend_transfers t
         JOIN linqasend_recipients r ON r.id = t.recipient_id
         WHERE t.user_id = $1
         ORDER BY t.created_at DESC
         LIMIT $2`,
        [p.userId, query.limit]
      );
      return {
        items: rows.map((r) => ({
          id: r.public_id,
          status: r.status,
          sendAmountMinor: String(r.send_amount_minor),
          sendCurrency: r.send_currency,
          receiveAmountMinor: String(r.receive_amount_minor),
          receiveCurrency: r.receive_currency,
          recipientName: r.recipient_name,
          createdAt: r.created_at,
          completedAt: r.completed_at
        }))
      };
    })
  );

  app.get(
    "/v1/linqasend/transfers/:id",
    withErrors(async (request, reply) => {
      const p = await authenticate(request);
      requireScope(p, "linqasend:read");
      const params = z.object({ id: z.string().min(1) }).parse(request.params);

      const { rows } = await db.query(
        `SELECT t.*, r.display_name AS recipient_name
         FROM linqasend_transfers t
         JOIN linqasend_recipients r ON r.id = t.recipient_id
         WHERE t.public_id = $1 AND t.user_id = $2`,
        [params.id, p.userId]
      );
      const row = rows[0];
      if (!row) return reply.code(404).send({ error: "transfer_not_found" });

      const attempts = await db.query(
        `SELECT phase, status, error_code, created_at FROM linqasend_transfer_attempts
         WHERE transfer_id = $1 ORDER BY created_at ASC`,
        [row.id]
      );

      return {
        id: row.public_id,
        status: row.status,
        sendAmountMinor: String(row.send_amount_minor),
        sendCurrency: row.send_currency,
        receiveAmountMinor: String(row.receive_amount_minor),
        receiveCurrency: row.receive_currency,
        recipientName: row.recipient_name,
        failureCode: row.failure_code,
        failureMessage: row.failure_message,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        timeline: attempts.rows.map((a) => ({
          phase: a.phase,
          status: a.status,
          errorCode: a.error_code,
          at: a.created_at
        }))
      };
    })
  );

  /**
   * Real webhook receiver for a future funding/payout provider — this
   * route did not exist before, so every transfer's funding/payout status
   * could only ever be updated by this process's own outbound calls, never
   * by an async provider push. Signature verification follows the same
   * timestamped-HMAC convention as `/v3/billing/webhook`
   * (services/billing/hmac-billing-webhook-verifier.ts): fails closed with
   * 401 if `LINQASEND_WEBHOOK_SECRET` isn't configured, which is the
   * expected state until a real provider is wired up.
   */
  app.post(
    "/v1/linqasend/webhooks/:provider",
    withErrors(async (request, reply) => {
      const params = z.object({ provider: z.string().min(1).max(64) }).parse(request.params);
      const signatureHeader = request.headers["x-linqasend-signature"];
      const rawBody = Buffer.isBuffer(request.body)
        ? request.body
        : Buffer.from(typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {}));

      const result = verifyLinqaSendWebhookSignature({
        secret: config.LINQASEND_WEBHOOK_SECRET,
        rawBody,
        signatureHeader: typeof signatureHeader === "string" ? signatureHeader : undefined,
        toleranceSeconds: config.LINQASEND_WEBHOOK_TOLERANCE_SECONDS
      });
      if (!result.valid) {
        request.log.warn({ provider: params.provider, reason: result.reason }, "linqasend webhook signature rejected");
        return reply.code(401).send({ error: "invalid_webhook_signature", reason: result.reason });
      }

      // No real provider is configured to have sent this, so there is
      // nothing legitimate to apply yet — the verified boundary above is
      // the real, tested part; a specific provider's payload-to-transfer
      // mapping is added when that provider is actually integrated.
      return reply.code(202).send({ received: true });
    })
  );

  /**
   * Admin-only reconciliation check: compares in-flight transfers against
   * whatever `providers.funding`/`providers.payout` report right now (see
   * integrations/linqasend/reconciliation.ts). With the safe-default
   * providers this always reports zero mismatches, since `lookup*` returns
   * null rather than fabricating provider state.
   */
  app.get(
    "/v1/linqasend/admin/reconciliation",
    withErrors(async (request) => {
      const p = await authenticate(request);
      requireScope(p, "linqasend:admin");
      return reconcileInFlightTransfers(db, providers);
    })
  );
}
