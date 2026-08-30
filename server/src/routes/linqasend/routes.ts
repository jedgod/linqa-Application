import { createHash, randomUUID } from "node:crypto";
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
import { registerAdvancedLinqaSendRoutes } from "./advanced-routes.js";
import { registerLinqaSendModuleSurfaceRoutes } from "./module-surface-routes.js";
import { LinqaSendReadinessService } from "../../services/linqasend/readiness.service.js";
import { deterministicTransferId, LinqaSendSecurityV4Service, TransactionSignatureService } from "../../services/linqasend/security-v4.js";
import { JurisdictionV2Service } from "../../services/linqasend/jurisdiction-v2.js";
import { AuthoritativeFraudSignalsService } from "../../services/linqasend/authoritative-fraud-signals.service.js";
import { AwsProductionKmsProvider } from "../../security/kms/production-kms-provider.js";
import { ProviderTokenVaultService } from "../../services/linqasend/provider-token-vault.service.js";

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
  sourceCountry: z.string().length(2).optional(),
  destinationCountry: z.string().length(2).optional(),
  sourceCurrency: z.string().length(3),
  destinationCurrency: z.string().length(3).optional(),
  paymentMethodId: z.string().uuid().optional(),
  sendAmountMinor: z.string().regex(/^\d+$/)
});

const createTransferSchema = z.object({
  quoteId: z.string().uuid(),
  paymentMethodId: z.string().uuid(),
  purposeCode: z.string().max(64).optional(),
  senderLegalName: z.string().min(1).max(160).optional(),
  senderCountry: z.string().length(2).optional(),
  securityAuthorizationId: z.string().uuid(),
  transactionHash: z.string().length(64),
  acknowledgedWarningCodes: z.array(z.string().max(100)).max(20).default([])
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
  await registerAdvancedLinqaSendRoutes(app, config, db);
  await registerLinqaSendModuleSurfaceRoutes(app, config, db);
  const authenticate = createAuthenticator(config);
  const fxPricing = new FxPricingService();
  const fxRates = new FxRateRepository(db);
  const quotes = new QuoteService(db, fxPricing, fxRates);
  const recipients = new RecipientResolverService(db);
  const risk = new RiskEngineService();
  const ledger = new LedgerService(db);
  const linqasendKms = config.LINQASEND_TOKEN_KMS_KEY_ID && config.LINQASEND_TOKEN_KMS_REGION
    ? new AwsProductionKmsProvider(config.LINQASEND_TOKEN_KMS_KEY_ID, config.LINQASEND_TOKEN_KMS_REGION) : undefined;
  const tokenVault = linqasendKms && config.LINQASEND_TOKEN_KMS_KEY_ID
    ? new ProviderTokenVaultService(db, linqasendKms, config.LINQASEND_TOKEN_KMS_KEY_ID)
    : undefined;
  const orchestrator = new TransferOrchestratorService(db, risk, ledger, providers, tokenVault);
  const readiness = new LinqaSendReadinessService(db, config.LINQASEND_RELEASE_GIT_SHA && config.LINQASEND_ARTIFACT_SHA256 ? { gitSha: config.LINQASEND_RELEASE_GIT_SHA, artifactDigest: config.LINQASEND_ARTIFACT_SHA256 } : undefined, { realMoneyEnabled: config.LINQASEND_REAL_MONEY_ENABLED === true, mode: config.LINQASEND_MODE ?? "SANDBOX_CERTIFICATION", ...(config.LINQASEND_LIMITED_LAUNCH_CORRIDOR_ID ? { limitedCorridorId: config.LINQASEND_LIMITED_LAUNCH_CORRIDOR_ID } : {}) });
  const securityV4 = new LinqaSendSecurityV4Service(db);
  const transactionSignatures = new TransactionSignatureService();
  const jurisdictionV2 = new JurisdictionV2Service(db);
  const fraudSignals = new AuthoritativeFraudSignalsService(db);

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
      if (!tokenVault) return reply.code(409).send({ error: "provider_token_kms_not_configured" });

      const id = randomUUID();
      const protectedReference = await tokenVault.store({ ownerUserId: p.userId, providerId: "manual-reference", secretKind: "UNVERIFIED_FUNDING_REFERENCE", plaintext: body.reference, ...(body.last4 ? { maskedDisplay: `•••• ${body.last4}` } : {}) });
      await db.query(
        `INSERT INTO linqasend_payment_methods(id, user_id, provider, provider_payment_method_ref, provider_secret_id, type, last4, billing_country, verification_status)
         VALUES ($1,$2,'manual-reference',$3,$4,$5,$6,$7,'PENDING')`,
        [id, p.userId, protectedReference, protectedReference.slice("vault:".length), body.type, body.last4 ?? null, body.billingCountry ?? null]
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
         VALUES ($1,$2,'LINQA_USER',$3,$4,$5,$6)`,
        [id, p.userId, resolved.userId, resolved.displayName, resolved.country, resolved.preferredCurrency]
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
        `SELECT id,country,preferred_currency FROM linqasend_recipients WHERE id = $1 AND owner_user_id = $2`,
        [body.recipientId, p.userId]
      );
      if (!recipientRow.rows[0]) throw new Error("recipient_not_found");
      const senderProfile = await jurisdictionV2.getProfile(p.userId);
      const verifiedRecipient = recipientRow.rows[0];
      if (body.destinationCurrency && body.destinationCurrency.toUpperCase() !== verifiedRecipient.preferred_currency) {
        throw new Error("destination_currency_not_recipient_authorized");
      }

      const corridor = await quotes.findCorridor(
        senderProfile.regulatoryJurisdiction,
        verifiedRecipient.country,
        body.sourceCurrency.toUpperCase(),
        verifiedRecipient.preferred_currency
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

      const replay = await db.query(`SELECT public_id,status FROM linqasend_transfers WHERE user_id=$1 AND idempotency_key=$2`, [p.userId, idempotencyKey]);
      if (replay.rows[0]) return reply.code(200).send({ transferId: replay.rows[0].public_id, status: replay.rows[0].status, idempotentReplay: true });

      if (!p.deviceId || !p.sessionId) return reply.code(401).send({ error: "device_bound_fresh_session_required" });

      const quote = await quotes.getActiveQuote(p.userId, body.quoteId);
      const recipientRow = await db.query(
        `SELECT id, display_name, country, recipient_type, linqa_user_id, payout_profile_ref FROM linqasend_recipients WHERE id = $1 AND owner_user_id = $2`,
        [quote.recipient_id, p.userId]
      );
      if (!recipientRow.rows[0]) return reply.code(404).send({ error: "recipient_not_found" });
      const recipient = recipientRow.rows[0];
      const paymentMethodResult = await db.query(`SELECT provider,provider_payment_method_ref,verification_status FROM linqasend_payment_methods WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`, [body.paymentMethodId,p.userId]);
      const paymentMethod = paymentMethodResult.rows[0];
      if (!paymentMethod || paymentMethod.verification_status !== "VERIFIED") return reply.code(409).send({ error: "verified_payment_method_required" });
      if (paymentMethod.provider !== quote.provider) return reply.code(409).send({ error: "payment_method_provider_mismatch" });

      const ready = await readiness.evaluate({
        userId: p.userId,
        recipientId: quote.recipient_id,
        paymentMethodId: body.paymentMethodId,
        sourceAmountMinor: BigInt(quote.send_amount_minor),
        sourceCurrency: quote.send_currency,
        destinationCurrency: quote.receive_currency,
        ...(body.purposeCode !== undefined ? { purposeCode: body.purposeCode } : {})
      });
      if (!ready.ready) return reply.code(409).send({ error: "real_money_not_ready", blockers: ready.blockers });

      const internalId = deterministicTransferId(p.userId, idempotencyKey);
      const secureTransfer = {
        id: internalId,
        senderUserId: p.userId,
        recipientId: recipient.id,
        quoteId: quote.id,
        sourceAmountMinor: BigInt(quote.send_amount_minor),
        sourceCurrency: quote.send_currency,
        destinationAmountMinor: BigInt(quote.receive_amount_minor),
        destinationCurrency: quote.receive_currency,
        fundingSourceId: body.paymentMethodId,
        transferClass: ready.transferClass
      };
      const expectedHash = transactionSignatures.buildTransactionHash(secureTransfer);
      if (body.transactionHash !== expectedHash) return reply.code(409).send({ error: "transaction_hash_mismatch", expectedTransactionHash: expectedHash });

      const priorWithRecipient = await db.query(
        `SELECT count(*)::int AS count FROM linqasend_transfers WHERE user_id = $1 AND recipient_id = $2`,
        [p.userId, recipient.id]
      );

      const installationId = request.headers["x-installation-id"];
      if (typeof installationId !== "string" || !z.string().uuid().safeParse(installationId).success || !z.string().uuid().safeParse(p.deviceId).success) {
        return reply.code(401).send({ error: "payment_device_binding_required" });
      }
      const authoritative = await fraudSignals.collect({
        userId: p.userId,
        deviceId: p.deviceId,
        installationId,
        paymentMethodId: body.paymentMethodId,
        sourceCountry: ready.sourceCountry,
        amountMinor: BigInt(quote.send_amount_minor),
        quoteCreatedAt: quote.created_at
      });
      const securityDecision = await securityV4.evaluate({
        transfer: secureTransfer,
        installationId,
        deviceId: p.deviceId,
        signals: authoritative.signals
      });
      if (securityDecision.blocked) return reply.code(409).send({ error: securityDecision.blockReason, securityIntentId: internalId, security: securityDecision });
      const missingWarnings = securityDecision.warnings.map((warning) => warning.code).filter((code) => !body.acknowledgedWarningCodes.includes(code));
      if (missingWarnings.length) return reply.code(409).send({ error: "scam_warning_acknowledgement_required", securityIntentId: internalId, warnings: securityDecision.warnings });
      await securityV4.consumeAuthorization({ authorizationId: body.securityAuthorizationId, userId: p.userId, deviceId: p.deviceId, transferId: internalId, transactionHash: expectedHash });

      const result = await orchestrator.createTransfer({
        internalId,
        deferExecution: config.LINQASEND_REAL_MONEY_ENABLED === true,
        beforeAdvance: async (transferId) => {
          await readiness.persistTransferReadiness(transferId, ready);
          await fraudSignals.persist({ transferId, authorizationId: body.securityAuthorizationId, userId: p.userId, deviceId: p.deviceId!, snapshot: authoritative });
        },
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
        recipient: { id: recipient.id, displayName: recipient.display_name, country: recipient.country, providerRecipientRef: recipient.recipient_type === "LINQA_USER" ? recipient.linqa_user_id : recipient.payout_profile_ref },
        paymentMethodId: body.paymentMethodId,
        paymentMethodRef: paymentMethod.provider_payment_method_ref,
        idempotencyKey,
        purposeCode: body.purposeCode,
        senderLegalName: ready.senderLegalName,
        senderCountry: ready.sourceCountry,
        authContext: {
          stepUpVerified: true,
          deviceTrusted: authoritative.signals.deviceTrusted,
          accountAgeDays: authoritative.signals.accountAgeDays,
          recentPasswordReset: authoritative.signals.recentPasswordReset,
          recentSimChange: authoritative.signals.recentSimChange,
          velocity24hMinor: authoritative.signals.velocity24hMinor,
          isNewRecipient: (priorWithRecipient.rows[0]?.count ?? 0) === 0,
          isNewPaymentMethod: authoritative.signals.fundingSourceAgeDays < 1,
          countryRiskScore: authoritative.signals.countryRiskScore
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
    { config: { rawBody: true } },
    withErrors(async (request, reply) => {
      const params = z.object({ provider: z.string().min(1).max(64) }).parse(request.params);
      const signatureHeader = request.headers["x-linqasend-signature"];
      const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
      if (!Buffer.isBuffer(rawBody)) return reply.code(400).send({ error: "original_webhook_bytes_required" });

      let webhookSecret = config.LINQASEND_WEBHOOK_SECRET;
      if (config.LINQASEND_REAL_MONEY_ENABLED === true) {
        if (!linqasendKms) return reply.code(503).send({ error: "webhook_key_kms_not_configured" });
        const key = await db.query(`SELECT key_version,encrypted_secret FROM linqasend_webhook_keys WHERE provider_id=$1 AND algorithm='HMAC_SHA256' AND active_from<=now() AND(active_to IS NULL OR active_to>now()) ORDER BY active_from DESC LIMIT 1`,[params.provider]);
        if (!key.rows[0]) return reply.code(401).send({ error: "active_provider_webhook_key_required" });
        const plaintext = await linqasendKms.decrypt({ciphertext:Buffer.from(key.rows[0].encrypted_secret),context:{provider_id:params.provider,key_version:key.rows[0].key_version,purpose:"webhook-signature"}});
        try { webhookSecret=plaintext.toString("utf8"); } finally { plaintext.fill(0); }
      }
      const result = verifyLinqaSendWebhookSignature({
        secret: webhookSecret,
        rawBody,
        signatureHeader: typeof signatureHeader === "string" ? signatureHeader : undefined,
        toleranceSeconds: config.LINQASEND_WEBHOOK_MAX_AGE_SECONDS ?? config.LINQASEND_WEBHOOK_TOLERANCE_SECONDS
      });
      if (!result.valid) {
        request.log.warn({ provider: params.provider, reason: result.reason }, "linqasend webhook signature rejected");
        return reply.code(401).send({ error: "invalid_webhook_signature", reason: result.reason });
      }

      // No real provider is configured to have sent this, so there is
      // nothing legitimate to apply yet — the verified boundary above is
      // the real, tested part; a specific provider's payload-to-transfer
      // mapping is added when that provider is actually integrated.
      const parsedPayload = z.object({ id: z.string().min(1).max(255), type: z.string().min(1).max(120), transferId: z.string().min(1).max(40).optional(), status: z.enum(["PAYOUT_PROCESSING", "COMPLETED", "FAILED", "ON_HOLD"]).optional(), providerReference: z.string().max(255).optional(), failureCode: z.string().max(64).optional() }).passthrough().parse(
        JSON.parse(rawBody.toString("utf8"))
      );
      const payloadHash = createHash("sha256").update(rawBody).digest("hex");
      const inserted = await db.query(
        `INSERT INTO linqasend_webhook_inbox(provider_id,provider_event_id,event_type,raw_body,payload_sha256,signature_header,signature_verified,timestamp_verified)
         VALUES($1,$2,$3,$4,$5,$6,true,true) ON CONFLICT(provider_id,provider_event_id) DO NOTHING RETURNING id`,
        [params.provider, parsedPayload.id, parsedPayload.type, rawBody, payloadHash, signatureHeader]
      );
      if (!inserted.rowCount) {
        return reply.code(200).send({ received: true, duplicate: true });
      }
      return reply.code(202).send({ received: true, duplicate: false, queued: true });
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
