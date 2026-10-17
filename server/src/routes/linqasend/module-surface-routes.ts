import { createPaymentAuthenticator } from "../../auth/payment-authenticator.js";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { requireScope } from "../../auth/jwt.js";
import { InactivePrincipalError } from "../../auth/active-principal.js";
import type { Database } from "../../db/pool.js";
import { normalizeIdentifier } from "../../auth/normalize.js";
import { RecipientResolverService } from "../../services/linqasend/recipient-resolver.service.js";
import { JurisdictionV2Service } from "../../services/linqasend/jurisdiction-v2.js";
import { SettlementTreasuryV5Service } from "../../services/linqasend/settlement-v5.js";
import { AwsProductionKmsProvider } from "../../security/kms/production-kms-provider.js";
import { ProviderTokenVaultService } from "../../services/linqasend/provider-token-vault.service.js";

function guarded<T>(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try { return await handler(request, reply); }
    catch (error) {
      if (error instanceof InactivePrincipalError) return reply.code(401).send({ error: "authentication_revoked" });
      if (error instanceof z.ZodError) return reply.code(422).send({ error: "validation_error", details: error.flatten() });
      request.log.warn({ err: error }, "linqasend module request rejected");
      return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid_request" });
    }
  };
}

import { DEV_SANDBOX_KEY_ID, DEV_SANDBOX_PROVIDER_ID, DevLocalKmsProvider, devSandboxCardProvider } from "../../services/linqasend/dev-sandbox.js";
import { CARD_FUNDING_TYPES, CvvRecollectionService, resolveCardProvider } from "../../services/linqasend/cvv-recollection.service.js";

const country = z.string().length(2).transform((v) => v.toUpperCase());
const currency = z.string().length(3).transform((v) => v.toUpperCase());
const amount = z.string().regex(/^\d+$/).transform(BigInt).refine((v) => v > 0n, "amount must be positive");
const deliveryMethod = z.enum(["BANK", "CARD", "MOBILE_MONEY", "PHONE_CLAIM", "EMAIL_CLAIM"]);

export async function registerLinqaSendModuleSurfaceRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  const authenticate = createPaymentAuthenticator(config, db);
  const resolver = new RecipientResolverService(db);
  const jurisdiction = new JurisdictionV2Service(db);
  const settlement = new SettlementTreasuryV5Service(db);
  const tokenVault = config.LINQASEND_TOKEN_KMS_KEY_ID && config.LINQASEND_TOKEN_KMS_REGION
    ? new ProviderTokenVaultService(db, new AwsProductionKmsProvider(config.LINQASEND_TOKEN_KMS_KEY_ID, config.LINQASEND_TOKEN_KMS_REGION), config.LINQASEND_TOKEN_KMS_KEY_ID)
    : undefined;
  // Development-only card sandbox (config.ts refuses it outside development/sandbox mode with real money off).
  const sandboxCards = devSandboxCardProvider(config);
  const fundingVault = tokenVault ?? (sandboxCards ? new ProviderTokenVaultService(db, new DevLocalKmsProvider(config.JWT_HS256_SECRET), DEV_SANDBOX_KEY_ID) : undefined);
  const cardProvider = resolveCardProvider(config);

  app.get("/v1/linqasend/home", guarded(async (request) => {
    const p = await authenticate(request); requireScope(p, "linqasend:read");
    const [transfers, recipients, methods, requests, profile] = await Promise.all([
      db.query(`SELECT t.public_id AS id,t.status,t.send_amount_minor,t.send_currency,t.receive_amount_minor,t.receive_currency,t.created_at,r.display_name AS recipient_name FROM linqasend_transfers t JOIN linqasend_recipients r ON r.id=t.recipient_id WHERE t.user_id=$1 ORDER BY t.created_at DESC LIMIT 5`, [p.userId]),
      db.query(`SELECT count(*)::int AS count FROM linqasend_recipients WHERE owner_user_id=$1`, [p.userId]),
      db.query(`SELECT count(*)::int AS count FROM linqasend_payment_methods WHERE user_id=$1 AND deleted_at IS NULL AND verification_status='VERIFIED'`, [p.userId]),
      db.query(`SELECT count(*) FILTER (WHERE payer_user_id=$1 AND status='PENDING')::int AS incoming,count(*) FILTER (WHERE requester_user_id=$1 AND status IN ('PENDING','AWAITING_PAYMENT'))::int AS outgoing FROM linqasend_money_requests_v1 WHERE requester_user_id=$1 OR payer_user_id=$1`, [p.userId]),
      jurisdiction.getProfile(p.userId)
    ]);
    return { jurisdiction: profile.regulatoryJurisdiction, recentTransfers: transfers.rows.map((r) => ({ ...r, send_amount_minor: String(r.send_amount_minor), receive_amount_minor: String(r.receive_amount_minor) })), recipientCount: recipients.rows[0]?.count ?? 0, verifiedFundingSourceCount: methods.rows[0]?.count ?? 0, requests: requests.rows[0] ?? { incoming: 0, outgoing: 0 } };
  }));

  app.post("/v1/linqasend/recipients/resolve/linqa", guarded(async (request, reply) => {
    const p = await authenticate(request); requireScope(p, "linqasend:read");
    const { query } = z.object({ query: z.string().trim().min(3).max(320) }).parse(request.body);
    const result = await resolver.resolveLinqaUser(query);
    if (!result || result.userId === p.userId) return reply.code(404).send({ error: "recipient_not_found" });
    return { recipientId: result.userId, type: "LINQA_USER", displayName: result.displayName, countryCode: result.country, currency: result.preferredCurrency, deliveryMethods: ["LINQA_PROFILE"], preferredDeliveryMethod: "LINQA_PROFILE" };
  }));

  /**
   * Certified payout providers a new external recipient may be attached to. The server, not the
   * client, decides which providers are acceptable; the create call re-checks certification.
   */
  app.get("/v1/linqasend/payout-providers", guarded(async (request) => {
    const p = await authenticate(request); requireScope(p, "linqasend:read");
    const { rows } = await db.query(`SELECT DISTINCT provider_id FROM linqasend_provider_certifications_v6 WHERE status='CERTIFIED' AND expires_at>now() ORDER BY provider_id`);
    return { items: rows.map((r) => ({ providerId: r.provider_id as string })) };
  }));

  app.post("/v1/linqasend/external-recipients", guarded(async (request, reply) => {
    const p = await authenticate(request); requireScope(p, "linqasend:write");
    const body = z.object({ recipientKind: z.enum(["EXTERNAL_PERSON", "EXTERNAL_BUSINESS"]), displayName: z.string().trim().min(2).max(160), countryCode: country, currency, deliveryMethod, provider: z.string().min(2).max(64), providerToken: z.string().min(8).max(512), maskedDisplay: z.string().min(3).max(160), phone: z.string().max(32).optional(), email: z.string().email().max(320).optional(), favorite: z.boolean().optional() }).strict().parse(request.body);
    const certified = await db.query(`SELECT 1 FROM linqasend_provider_certifications_v6 WHERE provider_id=$1 AND status='CERTIFIED' AND expires_at>now() LIMIT 1`, [body.provider]);
    if (!certified.rows[0]) return reply.code(409).send({ error: "certified_payout_provider_required" });
    if (!tokenVault) return reply.code(409).send({ error: "provider_token_kms_not_configured" });
    const protectedReference = await tokenVault.store({ ownerUserId: p.userId, providerId: body.provider, secretKind: "PAYOUT_ENDPOINT", plaintext: body.providerToken, maskedDisplay: body.maskedDisplay });
    const providerSecretId = protectedReference.slice("vault:".length);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const externalId = randomUUID(), endpointId = randomUUID(), recipientId = randomUUID();
      const hash = (value?: string) => value ? createHash("sha256").update(value.trim().toLowerCase()).digest("hex") : null;
      await client.query(`INSERT INTO linqasend_external_recipients_v1(id,owner_user_id,recipient_kind,display_name,country_code,currency,phone_hash,email_hash,verification_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'VERIFIED')`, [externalId, p.userId, body.recipientKind, body.displayName, body.countryCode, body.currency, hash(body.phone), hash(body.email)]);
      await client.query(`INSERT INTO linqasend_payout_endpoints_v1(id,external_recipient_id,delivery_method,provider,provider_token,provider_secret_id,masked_display,country_code,currency,status,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',now())`, [endpointId, externalId, body.deliveryMethod, body.provider, protectedReference, providerSecretId, body.maskedDisplay, body.countryCode, body.currency]);
      const recipientType = body.deliveryMethod === "MOBILE_MONEY" ? "MOBILE_WALLET" : body.deliveryMethod === "PHONE_CLAIM" ? "PHONE" : body.deliveryMethod === "EMAIL_CLAIM" ? "EMAIL" : body.deliveryMethod;
      await client.query(`INSERT INTO linqasend_recipients(id,owner_user_id,recipient_type,external_recipient_id,display_name,country,preferred_currency,payout_profile_ref,payout_provider,metadata,is_favorite) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [recipientId, p.userId, recipientType, externalId, body.displayName, body.countryCode, body.currency, protectedReference, body.provider, JSON.stringify({ deliveryMethod: body.deliveryMethod, maskedDisplay: body.maskedDisplay, payoutEndpointId: endpointId }), body.favorite === true]);
      await client.query("COMMIT");
      return reply.code(201).send({ id: externalId, recipientId, endpointId, verificationStatus: "VERIFIED" });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }));

  app.patch("/v1/linqasend/external-recipients/:id", guarded(async (request, reply) => {
    const p = await authenticate(request); requireScope(p, "linqasend:write");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ displayName: z.string().trim().min(2).max(160).optional() }).refine((v) => Object.keys(v).length > 0).parse(request.body);
    const result = await db.query(`UPDATE linqasend_external_recipients_v1 SET display_name=coalesce($3,display_name),updated_at=now() WHERE id=$1 AND owner_user_id=$2 RETURNING id`, [id, p.userId, body.displayName ?? null]);
    if (!result.rows[0]) return reply.code(404).send({ error: "external_recipient_not_found" });
    if (body.displayName) await db.query(`UPDATE linqasend_recipients SET display_name=$3,updated_at=now() WHERE owner_user_id=$1 AND external_recipient_id=$2`, [p.userId, id, body.displayName]);
    return { id };
  }));

  app.post("/v1/linqasend/recipients/resolve/external", guarded(async (request, reply) => {
    const p = await authenticate(request); requireScope(p, "linqasend:read");
    const { externalRecipientId } = z.object({ externalRecipientId: z.string().uuid() }).parse(request.body);
    const { rows } = await db.query(`SELECT r.id,r.display_name,r.country,r.preferred_currency,e.recipient_kind,p.delivery_method FROM linqasend_recipients r JOIN linqasend_external_recipients_v1 e ON e.id=r.external_recipient_id JOIN linqasend_payout_endpoints_v1 p ON p.external_recipient_id=e.id AND p.status='ACTIVE' WHERE e.id=$1 AND r.owner_user_id=$2`, [externalRecipientId, p.userId]);
    const row = rows[0];
    if (!row) return reply.code(404).send({ error: "external_recipient_not_found" });
    return { recipientId: row.id, type: row.recipient_kind, displayName: row.display_name, countryCode: row.country, currency: row.preferred_currency, deliveryMethods: rows.map((r) => r.delivery_method), preferredDeliveryMethod: row.delivery_method };
  }));

  app.post("/v1/linqasend/payment-methods/setup", guarded(async (request, reply) => {
    const p = await authenticate(request); requireScope(p, "linqasend:write");
    const body = z.object({ type: z.enum(["DEBIT_CARD", "CREDIT_CARD", "BANK_ACCOUNT", "MOBILE_WALLET"]), billingCountry: country.optional() }).parse(request.body);
    if (!cardProvider) return reply.code(409).send({ error: "provider_hosted_tokenization_not_configured" });
    const response = await fetch(`${cardProvider.url.replace(/\/$/, "")}/payment-methods/setup`, { method: "POST", headers: { authorization: `Bearer ${cardProvider.token}`, "content-type": "application/json" }, body: JSON.stringify({ userId: p.userId, ...body }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`TOKENIZATION_PROVIDER_ERROR:${response.status}`);
    const session = z.object({ setupToken: z.string().min(8), clientSecret: z.string().min(8), expiresAt: z.string().datetime(), ...(sandboxCards ? { cardEndpoint: z.string().url() } : {}) }).parse(await response.json());
    return reply.code(201).send(session);
  }));

  app.post("/v1/linqasend/payment-methods/confirm", guarded(async (request, reply) => {
    const p = await authenticate(request); requireScope(p, "linqasend:write");
    const body = z.object({ setupToken: z.string().min(8) }).parse(request.body);
    if (!cardProvider) return reply.code(409).send({ error: "provider_hosted_tokenization_not_configured" });
    const response = await fetch(`${cardProvider.url.replace(/\/$/, "")}/payment-methods/confirm`, { method: "POST", headers: { authorization: `Bearer ${cardProvider.token}`, "content-type": "application/json" }, body: JSON.stringify({ userId: p.userId, setupToken: body.setupToken }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`TOKENIZATION_PROVIDER_ERROR:${response.status}`);
    const method = z.object({ provider: z.string().min(2).max(64), providerCustomerRef: z.string().max(255).optional(), providerPaymentMethodRef: z.string().min(8).max(255), type: z.enum(["DEBIT_CARD", "CREDIT_CARD", "BANK_ACCOUNT", "MOBILE_WALLET"]), last4: z.string().length(4).optional(), billingCountry: country.optional(), verificationStatus: z.literal("VERIFIED"), brand: z.string().trim().max(24).optional(), expMonth: z.number().int().min(1).max(12).optional(), expYear: z.number().int().min(2000).max(2200).optional() }).parse(await response.json());
    // Only the development sandbox provider, and only while the sandbox is active, skips the certification lookup.
    const sandboxFundingSource = sandboxCards !== null && method.provider === DEV_SANDBOX_PROVIDER_ID;
    const certified = sandboxFundingSource ? { rows: [1] } : await db.query(`SELECT 1 FROM linqasend_provider_certifications_v6 WHERE provider_id=$1 AND status='CERTIFIED' AND expires_at>now() LIMIT 1`, [method.provider]);
    if (!certified.rows[0]) return reply.code(409).send({ error: "certified_funding_provider_required" });
    if (!fundingVault) return reply.code(409).send({ error: "provider_token_kms_not_configured" });
    const protectedReference = await fundingVault.store({ ownerUserId: p.userId, providerId: method.provider, secretKind: "FUNDING_METHOD", plaintext: method.providerPaymentMethodRef, ...(method.last4 ? { maskedDisplay: `•••• ${method.last4}` } : {}) });
    const providerSecretId = protectedReference.slice("vault:".length);
    const id = randomUUID();
    const { rows } = await db.query(`INSERT INTO linqasend_payment_methods(id,user_id,provider,provider_customer_ref,provider_payment_method_ref,provider_secret_id,type,last4,billing_country,verification_status,metadata) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,'VERIFIED',$9::jsonb) ON CONFLICT(provider,provider_payment_method_ref) DO UPDATE SET updated_at=now() RETURNING id,type,last4,verification_status`, [id, p.userId, method.provider, protectedReference, providerSecretId, method.type, method.last4 ?? null, method.billingCountry ?? null, JSON.stringify({ ...(method.brand ? { brand: method.brand } : {}), ...(method.expMonth ? { expMonth: method.expMonth } : {}), ...(method.expYear ? { expYear: method.expYear } : {}) })]);
    return reply.code(201).send({ id: rows[0].id, type: rows[0].type, last4: rows[0].last4, verificationStatus: rows[0].verification_status });
  }));

  // Card security-code recollection: a one-time session for the card the sender is about to pay with. The code is typed on
  // the phone and posted straight to the provider; the transfer route later spends this session exactly once.
  const cvvRecollection = new CvvRecollectionService(db, cardProvider);
  app.post("/v1/linqasend/payment-methods/:id/cvv-session", guarded(async (request, reply) => {
    const p = await authenticate(request); requireScope(p, "linqasend:write");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const row = (await db.query(`SELECT type,provider_payment_method_ref FROM linqasend_payment_methods WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL AND verification_status='VERIFIED'`, [id, p.userId])).rows[0];
    if (!row) return reply.code(404).send({ error: "payment_method_not_found" });
    if (!(CARD_FUNDING_TYPES as readonly string[]).includes(row.type)) return reply.code(409).send({ error: "cvv_not_applicable" });
    if (!cardProvider || !fundingVault) return reply.code(409).send({ error: "cvv_provider_not_configured" });
    const providerPaymentMethodRef = await fundingVault.resolve(row.provider_payment_method_ref, { actorId: p.userId, purpose: "CVV_RECOLLECTION", expectedOwnerUserId: p.userId });
    return reply.code(201).send(await cvvRecollection.createSession({ userId: p.userId, paymentMethodId: id, providerPaymentMethodRef }));
  }));

  app.delete("/v1/linqasend/payment-methods/:id", guarded(async (request, reply) => {
    const p = await authenticate(request); requireScope(p, "linqasend:write");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const active = await db.query(`SELECT 1 FROM linqasend_transfers WHERE user_id=$1 AND payment_method_id=$2 AND status NOT IN ('COMPLETED','DECLINED','CANCELED','EXPIRED','FAILED','REVERSED','REFUNDED','CHARGEBACK') LIMIT 1`, [p.userId, id]);
    if (active.rows[0]) return reply.code(409).send({ error: "funding_source_has_active_transfer" });
    const result = await db.query(`UPDATE linqasend_payment_methods SET deleted_at=now(),verification_status='REMOVED',is_default=false,updated_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`, [id, p.userId]);
    return reply.code(result.rowCount ? 204 : 404).send(result.rowCount ? undefined : { error: "payment_method_not_found" });
  }));

  app.get("/v1/linqasend/receive-profile", guarded(async (request) => {
    const p = await authenticate(request); requireScope(p, "linqasend:read");
    const [profile, identifiers, settings, method] = await Promise.all([
      db.query(`SELECT display_name FROM user_profiles WHERE user_id=$1`, [p.userId]),
      db.query(`SELECT type,display_value FROM account_identifiers WHERE user_id=$1 AND verified_at IS NOT NULL AND disabled_at IS NULL ORDER BY CASE type WHEN 'EMAIL' THEN 1 ELSE 2 END`, [p.userId]),
      db.query(`SELECT default_currency FROM linqasend_user_settings_v1 WHERE user_id=$1`, [p.userId]),
      db.query(`SELECT type,last4 FROM linqasend_payment_methods WHERE user_id=$1 AND deleted_at IS NULL AND verification_status='VERIFIED' ORDER BY is_default DESC,created_at DESC LIMIT 1`, [p.userId])
    ]);
    return { displayName: profile.rows[0]?.display_name ?? null, identifiers: identifiers.rows, defaultCurrency: settings.rows[0]?.default_currency ?? null, preferredFundingSource: method.rows[0] ? { type: method.rows[0].type, last4: method.rows[0].last4 } : null };
  }));

  app.get("/v1/linqasend/limits", guarded(async (request) => {
    const p = await authenticate(request); requireScope(p, "linqasend:read");
    const profile = await jurisdiction.getProfile(p.userId);
    const [countryPolicy, corridors, used, cohort, month] = await Promise.all([
      db.query(`SELECT version,domestic_internal_status,cross_border_outbound_status,allowed_funding_modes,allowed_receive_modes FROM linqasend_country_capabilities_v3 WHERE country=$1 AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now()) ORDER BY version DESC LIMIT 1`, [profile.regulatoryJurisdiction]),
      db.query(`SELECT destination_country,source_currencies,destination_currencies,min_amount_minor,max_amount_minor,status FROM linqasend_corridor_rules_v3 WHERE source_country=$1 AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now()) ORDER BY destination_country,version DESC`, [profile.regulatoryJurisdiction]),
      db.query(`SELECT coalesce(sum(send_amount_minor),0)::bigint AS used_minor,count(*)::int AS transfer_count FROM linqasend_transfers WHERE user_id=$1 AND created_at>now()-interval '24 hours' AND status NOT IN ('DECLINED','CANCELED','EXPIRED','FAILED')`, [p.userId]),
      db.query(`SELECT min(c.per_transfer_limit_minor)::bigint AS per_transfer_minor, min(c.daily_user_limit_minor)::bigint AS daily_minor FROM linqasend_launch_cohorts c JOIN linqasend_launch_cohort_members m ON m.cohort_id=c.id AND m.user_id=$1 AND m.removed_at IS NULL WHERE c.status='ACTIVE'`, [p.userId]),
      db.query(`SELECT coalesce(sum(send_amount_minor),0)::bigint AS used_minor FROM linqasend_transfers WHERE user_id=$1 AND send_currency='USD' AND created_at>now()-interval '30 days' AND status NOT IN ('DECLINED','CANCELED','EXPIRED','FAILED')`, [p.userId])
    ]);
    // Limits are reported only where one really exists. A null limit means "no fixed limit on this account", never a guess.
    const dailyLimit = cohort.rows[0]?.daily_minor ?? null;
    const dailyUsed = BigInt(used.rows[0]?.used_minor ?? 0);
    const remaining = (limit: unknown, spent: bigint) => (limit === null || limit === undefined ? null : String(BigInt(limit as string) > spent ? BigInt(limit as string) - spent : 0n));
    return { jurisdiction: profile.regulatoryJurisdiction, countryCapability: countryPolicy.rows[0] ?? null, corridors: corridors.rows.map((r) => ({ ...r, min_amount_minor: r.min_amount_minor === null ? null : String(r.min_amount_minor), max_amount_minor: r.max_amount_minor === null ? null : String(r.max_amount_minor) })), rolling24Hours: { usedMinor: String(used.rows[0]?.used_minor ?? 0), transferCount: used.rows[0]?.transfer_count ?? 0 },
      currency: "USD",
      perTransferLimitMinor: cohort.rows[0]?.per_transfer_minor === null || cohort.rows[0]?.per_transfer_minor === undefined ? null : String(cohort.rows[0].per_transfer_minor),
      daily: { limitMinor: dailyLimit === null ? null : String(dailyLimit), usedMinor: String(dailyUsed), remainingMinor: remaining(dailyLimit, dailyUsed) },
      monthly: { limitMinor: null, usedMinor: String(month.rows[0]?.used_minor ?? 0), remainingMinor: null } };
  }));

  app.get("/v1/linqasend/settings", guarded(async (request) => {
    const p = await authenticate(request); requireScope(p, "linqasend:read");
    const { rows } = await db.query(`SELECT default_currency,default_payment_method_id,transfer_notifications,request_notifications,scam_warning_level,updated_at FROM linqasend_user_settings_v1 WHERE user_id=$1`, [p.userId]);
    return rows[0] ?? { default_currency: null, default_payment_method_id: null, transfer_notifications: true, request_notifications: true, scam_warning_level: "STANDARD", updated_at: null };
  }));

  app.patch("/v1/linqasend/settings", guarded(async (request) => {
    const p = await authenticate(request); requireScope(p, "linqasend:write");
    const body = z.object({ defaultCurrency: currency.nullable().optional(), defaultPaymentMethodId: z.string().uuid().nullable().optional(), transferNotifications: z.boolean().optional(), requestNotifications: z.boolean().optional(), scamWarningLevel: z.enum(["STANDARD", "ENHANCED"]).optional() }).parse(request.body);
    if (body.defaultPaymentMethodId) {
      const owned = await db.query(`SELECT 1 FROM linqasend_payment_methods WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL AND verification_status='VERIFIED'`, [body.defaultPaymentMethodId, p.userId]);
      if (!owned.rows[0]) throw new Error("VERIFIED_DEFAULT_FUNDING_SOURCE_REQUIRED");
    }
    await db.query(`INSERT INTO linqasend_user_settings_v1(user_id,default_currency,default_payment_method_id,transfer_notifications,request_notifications,scam_warning_level) VALUES($1,$2,$3,coalesce($4,true),coalesce($5,true),coalesce($6,'STANDARD')) ON CONFLICT(user_id) DO UPDATE SET default_currency=coalesce($2,linqasend_user_settings_v1.default_currency),default_payment_method_id=coalesce($3,linqasend_user_settings_v1.default_payment_method_id),transfer_notifications=coalesce($4,linqasend_user_settings_v1.transfer_notifications),request_notifications=coalesce($5,linqasend_user_settings_v1.request_notifications),scam_warning_level=coalesce($6,linqasend_user_settings_v1.scam_warning_level),updated_at=now()`, [p.userId, body.defaultCurrency ?? null, body.defaultPaymentMethodId ?? null, body.transferNotifications ?? null, body.requestNotifications ?? null, body.scamWarningLevel ?? null]);
    if (body.defaultPaymentMethodId) {
      await db.query(`UPDATE linqasend_payment_methods SET is_default=(id=$2),updated_at=now() WHERE user_id=$1 AND deleted_at IS NULL`, [p.userId, body.defaultPaymentMethodId]);
    }
    return { updated: true };
  }));

  app.post("/v1/linqasend/requests", guarded(async (request, reply) => {
    const p = await authenticate(request); requireScope(p, "linqasend:write");
    const body = z.object({ payer: z.string().trim().min(3).max(320), amountMinor: amount, currency, note: z.string().trim().max(500).optional() }).parse(request.body);
    const payer = await resolver.resolveLinqaUser(body.payer);
    if (!payer || payer.userId === p.userId) return reply.code(404).send({ error: "payer_not_found" });
    const requester = await db.query(`SELECT coalesce(up.display_name,ai.display_value) AS display_name,u.verified_country_code FROM users u LEFT JOIN user_profiles up ON up.user_id=u.id LEFT JOIN LATERAL (SELECT display_value FROM account_identifiers WHERE user_id=u.id AND verified_at IS NOT NULL AND disabled_at IS NULL LIMIT 1) ai ON true WHERE u.id=$1`, [p.userId]);
    if (!requester.rows[0]) throw new Error("REQUESTER_PROFILE_NOT_FOUND");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      let recipient = await client.query(`SELECT id FROM linqasend_recipients WHERE owner_user_id=$1 AND linqa_user_id=$2 ORDER BY created_at LIMIT 1`, [payer.userId, p.userId]);
      if (!recipient.rows[0]) recipient = await client.query(`INSERT INTO linqasend_recipients(owner_user_id,recipient_type,linqa_user_id,display_name,country,preferred_currency) VALUES($1,'LINQA_USER',$2,$3,$4,$5) RETURNING id`, [payer.userId, p.userId, requester.rows[0].display_name, requester.rows[0].verified_country_code, body.currency]);
      const id = randomUUID();
      await client.query(`INSERT INTO linqasend_money_requests_v1(id,requester_user_id,payer_user_id,payer_recipient_id,amount_minor,currency,note) VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, p.userId, payer.userId, recipient.rows[0].id, body.amountMinor.toString(), body.currency, body.note ?? null]);
      await client.query(`INSERT INTO linqasend_notification_outbox_v1(user_id,notification_type,payload,dedupe_key) VALUES($1,'MONEY_REQUEST_CREATED',$2,$3) ON CONFLICT(dedupe_key) DO NOTHING`, [payer.userId, JSON.stringify({ requestId: id, requesterName: requester.rows[0].display_name, amountMinor: body.amountMinor.toString(), currency: body.currency }), `money-request:${id}:created`]);
      await client.query("COMMIT");
      return reply.code(201).send({ id, status: "PENDING" });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }));

  app.get("/v1/linqasend/requests", guarded(async (request) => {
    const p = await authenticate(request); requireScope(p, "linqasend:read");
    const { rows } = await db.query(`SELECT q.*,requester.display_name AS requester_name,payer.display_name AS payer_name FROM linqasend_money_requests_v1 q LEFT JOIN user_profiles requester ON requester.user_id=q.requester_user_id LEFT JOIN user_profiles payer ON payer.user_id=q.payer_user_id WHERE q.requester_user_id=$1 OR q.payer_user_id=$1 ORDER BY q.created_at DESC LIMIT 100`, [p.userId]);
    return { items: rows.map((r) => ({ id: r.id, direction: r.requester_user_id === p.userId ? "OUTGOING" : "INCOMING", counterpartyName: r.requester_user_id === p.userId ? r.payer_name : r.requester_name, amountMinor: String(r.amount_minor), currency: r.currency, note: r.note, status: r.status, recipientId: r.payer_recipient_id, expiresAt: r.expires_at, createdAt: r.created_at })) };
  }));

  app.post("/v1/linqasend/requests/:id/pay", guarded(async (request, reply) => {
    const p = await authenticate(request); requireScope(p, "linqasend:write");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { rows } = await db.query(`UPDATE linqasend_money_requests_v1 SET status='AWAITING_PAYMENT',updated_at=now() WHERE id=$1 AND payer_user_id=$2 AND status='PENDING' AND expires_at>now() RETURNING payer_recipient_id,amount_minor,currency,note`, [id, p.userId]);
    if (!rows[0]) return reply.code(409).send({ error: "request_not_payable" });
    return { requestId: id, recipientId: rows[0].payer_recipient_id, amountMinor: String(rows[0].amount_minor), currency: rows[0].currency, purposeCode: `REQUEST:${id}` };
  }));

  app.post("/v1/linqasend/requests/:id/decline", guarded(async (request, reply) => {
    const p = await authenticate(request); requireScope(p, "linqasend:write");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await db.query(`UPDATE linqasend_money_requests_v1 SET status='DECLINED',updated_at=now() WHERE id=$1 AND payer_user_id=$2 AND status='PENDING'`, [id, p.userId]);
    return reply.code(result.rowCount ? 204 : 409).send(result.rowCount ? undefined : { error: "request_not_declinable" });
  }));

  app.post("/v1/linqasend/transfers/:id/cancel", guarded(async (request, reply) => {
    const p = await authenticate(request); requireScope(p, "linqasend:write");
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(request.params);
    const result = await db.query(`UPDATE linqasend_transfers SET status='CANCELED',updated_at=now() WHERE public_id=$1 AND user_id=$2 AND status IN ('CREATED','QUOTE_CREATED','AWAITING_CONFIRMATION','REQUIRES_ACTION') RETURNING public_id`, [id, p.userId]);
    if (!result.rows[0]) return reply.code(409).send({ error: "transfer_not_cancelable" });
    return { id, status: "CANCELED" };
  }));

  app.post("/v1/linqasend/transfers/:id/refund", guarded(async (request, reply) => {
    const p = await authenticate(request); requireScope(p, "linqasend:write");
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(request.params);
    const body = z.object({ reasonCode: z.string().min(3).max(120), notes: z.string().max(1000).optional() }).parse(request.body);
    const transfer = await db.query(`SELECT id FROM linqasend_transfers WHERE public_id=$1 AND user_id=$2 AND status='COMPLETED'`, [id, p.userId]);
    if (!transfer.rows[0]) return reply.code(409).send({ error: "completed_transfer_required" });
    return reply.code(202).send(await settlement.requestMoneyAdjustment({ transferId: transfer.rows[0].id, type: "FULL_REFUND", requestedBy: p.userId, reasonCode: body.reasonCode, ...(body.notes !== undefined ? { notes: body.notes } : {}) }));
  }));
}
