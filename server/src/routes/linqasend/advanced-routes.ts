import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAuthenticator, requireScope } from "../../auth/jwt.js";
import type { Database } from "../../db/pool.js";
import { LinqaSendReadinessService } from "../../services/linqasend/readiness.service.js";
import { JurisdictionV2Service, LocationSignalType, SensitiveAction } from "../../services/linqasend/jurisdiction-v2.js";
import { SettlementTreasuryV5Service } from "../../services/linqasend/settlement-v5.js";
import { ProductionClosureV6Service } from "../../services/linqasend/closure-v6.js";
import { RegulatedEntityResolverV7 } from "../../services/linqasend/regulatory-v7.js";
import { deterministicTransferId, LinqaSendSecurityV4Service, TransactionSignatureService } from "../../services/linqasend/security-v4.js";
import { LinqaSendLaunchControlService } from "../../services/linqasend/launch-control.service.js";
import type { BiometricAuthorizationService } from "../../security/biometrics/service.js";
import { biometricPrincipal } from "../biometrics.js";

function guarded<T>(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try { return await handler(request, reply); }
    catch (error) {
      if (error instanceof z.ZodError) return reply.code(422).send({ error: "validation_error", details: error.flatten() });
      request.log.warn({ err: error }, "advanced linqasend request rejected");
      return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid_request" });
    }
  };
}

const money = z.string().regex(/^\d+$/).transform(BigInt);
const country = z.string().length(2).transform((v) => v.toUpperCase());
const currency = z.string().length(3).transform((v) => v.toUpperCase());

export async function registerAdvancedLinqaSendRoutes(app: FastifyInstance, config: AppConfig, db: Database, biometrics?: BiometricAuthorizationService) {
  const auth = createAuthenticator(config);
  const readiness = new LinqaSendReadinessService(db, config.LINQASEND_RELEASE_GIT_SHA && config.LINQASEND_ARTIFACT_SHA256 ? { gitSha: config.LINQASEND_RELEASE_GIT_SHA, artifactDigest: config.LINQASEND_ARTIFACT_SHA256 } : undefined, { realMoneyEnabled: config.LINQASEND_REAL_MONEY_ENABLED === true, mode: config.LINQASEND_MODE ?? "SANDBOX_CERTIFICATION", ...(config.LINQASEND_LIMITED_LAUNCH_CORRIDOR_ID ? { limitedCorridorId: config.LINQASEND_LIMITED_LAUNCH_CORRIDOR_ID } : {}) });
  const jurisdiction = new JurisdictionV2Service(db);
  const settlement = new SettlementTreasuryV5Service(db);
  const closure = new ProductionClosureV6Service(db);
  const regulatory = new RegulatedEntityResolverV7(db);
  const signatures = new TransactionSignatureService();
  const security = new LinqaSendSecurityV4Service(db);
  const launch = new LinqaSendLaunchControlService(db);

  app.post("/v1/linqasend/prepare", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "linqasend:write");
    const body = z.object({ recipientId: z.string().uuid(), paymentMethodId: z.string().uuid(), sourceAmountMinor: money, sourceCurrency: currency, destinationCurrency: currency, purposeCode: z.string().max(64).optional(), quoteId: z.string().uuid().optional(), receiveAmountMinor: money.optional(), idempotencyKey: z.string().min(16).max(160).optional() }).parse(request.body);
    const result = await readiness.evaluate({ userId: p.userId, recipientId: body.recipientId, paymentMethodId: body.paymentMethodId, sourceAmountMinor: body.sourceAmountMinor, sourceCurrency: body.sourceCurrency, destinationCurrency: body.destinationCurrency, ...(body.purposeCode !== undefined ? { purposeCode: body.purposeCode } : {}) });
    let confirmation: { securityIntentId: string; transactionHash: string } | undefined;
    if (result.ready && body.quoteId && body.receiveAmountMinor !== undefined && body.idempotencyKey) {
      const securityIntentId = deterministicTransferId(p.userId, body.idempotencyKey);
      const transactionHash = signatures.buildTransactionHash({ id: securityIntentId, senderUserId: p.userId, recipientId: body.recipientId, quoteId: body.quoteId, sourceAmountMinor: body.sourceAmountMinor, sourceCurrency: body.sourceCurrency, destinationAmountMinor: body.receiveAmountMinor, destinationCurrency: body.destinationCurrency, fundingSourceId: body.paymentMethodId, transferClass: result.transferClass });
      confirmation = { securityIntentId, transactionHash };
    }
    return reply.code(result.ready ? 200 : 409).send({ ...result, sourceAmountMinor: body.sourceAmountMinor.toString(), ...(confirmation ? { confirmation } : {}) });
  }));

  app.post("/v1/linqasend/security/challenges", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "linqasend:write");
    if (!p.deviceId || !z.string().uuid().safeParse(p.deviceId).success) return reply.code(401).send({ error: "device_bound_token_required" });
    const installationId = request.headers["x-installation-id"];
    if (typeof installationId !== "string" || !z.string().uuid().safeParse(installationId).success) return reply.code(401).send({ error: "installation_binding_required" });
    const installation = await db.query(`SELECT 1 FROM installation_accounts_v2 WHERE installation_id=$1 AND user_id=$2 AND state='ACTIVE'`, [installationId, p.userId]);
    if (!installation.rows[0]) return reply.code(401).send({ error: "installation_account_binding_mismatch" });
    await db.query(`INSERT INTO linqasend_trusted_payment_devices_v4(user_id,installation_id,device_id,device_binding_key_id,trust_state) VALUES($1,$2,$3,$3,'UNKNOWN') ON CONFLICT(user_id,installation_id,device_id) DO UPDATE SET last_seen_at=now()`, [p.userId, installationId, p.deviceId]);
    const body = z.object({ quoteId: z.string().uuid(), paymentMethodId: z.string().uuid(), idempotencyKey: z.string().min(16).max(160) }).parse(request.body);
    const quoteResult = await db.query(`SELECT q.*,r.country AS destination_country,r.preferred_currency,r.id AS recipient_id FROM linqasend_quotes q JOIN linqasend_recipients r ON r.id=q.recipient_id WHERE q.id=$1 AND q.user_id=$2 AND q.status='ACTIVE' AND q.expires_at>now()`, [body.quoteId, p.userId]);
    const quote = quoteResult.rows[0];
    if (!quote) return reply.code(404).send({ error: "active_quote_not_found" });
    const ready = await readiness.evaluate({ userId: p.userId, recipientId: quote.recipient_id, paymentMethodId: body.paymentMethodId, sourceAmountMinor: BigInt(quote.send_amount_minor), sourceCurrency: quote.send_currency, destinationCurrency: quote.receive_currency });
    if (!ready.ready) return reply.code(409).send({ error: "real_money_not_ready", blockers: ready.blockers });
    const transfer = { id: deterministicTransferId(p.userId, body.idempotencyKey), senderUserId: p.userId, recipientId: quote.recipient_id, quoteId: quote.id, sourceAmountMinor: BigInt(quote.send_amount_minor), sourceCurrency: quote.send_currency, destinationAmountMinor: BigInt(quote.receive_amount_minor), destinationCurrency: quote.receive_currency, fundingSourceId: body.paymentMethodId, transferClass: ready.transferClass };
    const challenge = await security.createChallenge({ transfer, installationId, deviceId: p.deviceId });
    await db.query(`UPDATE linqasend_transaction_challenges_v4 SET biometric_quote_id=$2,biometric_payment_method_id=$3 WHERE id=$1`,[challenge.id,quote.id,body.paymentMethodId]);
    return reply.code(201).send({ ...challenge, securityIntentId: transfer.id });
  }));

  app.post("/v1/linqasend/security/authorizations", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "linqasend:write");
    if (!p.deviceId) return reply.code(401).send({ error: "device_bound_token_required" });
    const body = z.union([
      z.object({ challengeId: z.string().uuid(), biometricGrantId: z.string().uuid() }).strict(),
      z.object({ challengeId: z.string().uuid(), signatureBase64: z.string().min(80).max(120) }).strict()
    ]).parse(request.body);
    if ("biometricGrantId" in body) {
      if (!biometrics) return reply.code(503).send({ error: "BIOMETRIC_NOT_CONFIGURED" });
      const principal = biometricPrincipal(p,request);
      return reply.code(201).send(await biometrics.transaction(async client => {
        await biometrics.guard(client,principal);
        const resource = await biometrics.resource(client,principal,"SEND_TRANSFER_AUTHORIZE",{ paymentChallengeId: body.challengeId });
        const grant = await biometrics.consume(client,principal,body.biometricGrantId,"SEND_TRANSFER_AUTHORIZE",resource);
        const consumed = await client.query(`UPDATE linqasend_transaction_challenges_v4 SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING transfer_id,expected_transaction_hash`,[body.challengeId]);
        const challenge = consumed.rows[0]; if (!challenge) throw new Error("BIOMETRIC_PAYMENT_CHALLENGE_EXPIRED");
        const authorizationId = randomUUID(), expiresAt = new Date(Date.now()+90_000);
        await client.query(`INSERT INTO linqasend_transaction_authorizations_v4(id,transfer_id,user_id,jti,transaction_hash,device_binding_key_id,auth_method,expires_at,biometric_credential_id,biometric_security_epoch,biometric_session_id,biometric_installation_id,biometric_payment_challenge_id,biometric_resource_hash)
          VALUES($1,$2,$3,$4,$5,$6,'DEVICE_BIOMETRIC',$7,$8,$9,$10,$11,$12,$13)`,[authorizationId,challenge.transfer_id,p.userId,randomUUID(),challenge.expected_transaction_hash,p.deviceId,expiresAt,grant.credential_id,grant.security_epoch,principal.sessionId,principal.installationId,body.challengeId,grant.resource_hash]);
        return { authorizationId,transactionHash: challenge.expected_transaction_hash,expiresAt: expiresAt.toISOString() };
      }));
    }
    // Production transfers require a hardware-backed biometric assertion, never a software-key substitute.
    if (config.NODE_ENV === "production") return reply.code(403).send({ error: "BIOMETRIC_PAYMENT_AUTHORIZATION_REQUIRED" });
    return reply.code(201).send(await security.authorizeChallenge({ ...body, userId: p.userId, deviceId: p.deviceId }));
  }));

  app.get("/v1/linqasend/jurisdiction", guarded(async (request) => {
    const p = await auth(request); requireScope(p, "linqasend:read");
    return jurisdiction.getProfile(p.userId);
  }));

  app.post("/v1/linqasend/jurisdiction/location-assessments", guarded(async (request) => {
    const p = await auth(request); requireScope(p, "linqasend:write");
    const body = z.object({ signals: z.array(z.object({ type: z.nativeEnum(LocationSignalType), country: country.nullable(), confidence: z.number().min(0).max(1), observedAt: z.coerce.date(), metadata: z.record(z.string(), z.unknown()).optional() })).min(1).max(12), proxyDetected: z.boolean().optional(), torDetected: z.boolean().optional(), sessionTakeoverRisk: z.boolean().optional(), priorSimCountry: country.nullable().optional(), currentSimCountry: country.nullable().optional() }).parse(request.body);
    return jurisdiction.assessLocation({ userId: p.userId, newDevice: !p.deviceId, signals: body.signals.map((signal) => ({ type: signal.type, country: signal.country, confidence: signal.confidence, observedAt: signal.observedAt, ...(signal.metadata !== undefined ? { metadata: signal.metadata } : {}) })), ...(body.proxyDetected !== undefined ? { proxyDetected: body.proxyDetected } : {}), ...(body.torDetected !== undefined ? { torDetected: body.torDetected } : {}), ...(body.sessionTakeoverRisk !== undefined ? { sessionTakeoverRisk: body.sessionTakeoverRisk } : {}), ...(body.priorSimCountry !== undefined ? { priorSimCountry: body.priorSimCountry } : {}), ...(body.currentSimCountry !== undefined ? { currentSimCountry: body.currentSimCountry } : {}) });
  }));

  app.post("/v1/linqasend/jurisdiction/authorize", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "linqasend:write");
    const body = z.object({ action: z.nativeEnum(SensitiveAction), walletId: z.string().uuid().optional(), amountMinor: money.optional(), currency: currency.optional(), location: z.object({ currentPhysicalCountry: country.nullable(), locationRelationship: z.any(), riskSignals: z.array(z.any()), requiresStepUpAuth: z.boolean(), jurisdictionChanged: z.literal(false) }) }).parse(request.body);
    const decision = await jurisdiction.authorizeSensitiveAction({ userId: p.userId, action: body.action, location: body.location, ...(p.deviceId !== undefined ? { deviceId: p.deviceId } : {}), ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}), ...(body.walletId !== undefined ? { walletId: body.walletId } : {}), ...(body.amountMinor !== undefined ? { amountMinor: body.amountMinor } : {}), ...(body.currency !== undefined ? { currency: body.currency } : {}) });
    return reply.code(decision.allowed ? 200 : 409).send(decision);
  }));

  app.post("/v1/linqasend/jurisdiction/relocations", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "linqasend:write");
    const body = z.object({ targetCountry: country, reason: z.string().max(500).optional() }).parse(request.body);
    return reply.code(202).send(await jurisdiction.requestRelocation(p.userId, body.targetCountry, body.reason));
  }));

  app.get("/v1/linqasend/jurisdiction/relocations", guarded(async (request) => {
    const p = await auth(request); requireScope(p, "linqasend:read");
    const { rows } = await db.query(`SELECT id,from_country,requested_country,status,reason,decision_version,requested_at,decided_at FROM jurisdiction_relocation_requests_v2 WHERE user_id=$1 ORDER BY requested_at DESC`, [p.userId]);
    return { items: rows };
  }));

  app.post("/v1/linqasend/jurisdiction/relocations/:id/evidence", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "linqasend:write");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ evidenceType: z.enum(["GOVERNMENT_ID", "RESIDENCE_PERMIT", "VISA", "UTILITY_BILL", "BANK_STATEMENT", "TAX_DOCUMENT", "TENANCY_AGREEMENT", "EMPLOYMENT_DOCUMENT", "SCHOOL_ENROLLMENT", "GOVERNMENT_LETTER"]), evidenceClass: z.enum(["IDENTITY", "RESIDENCY_RIGHT", "ADDRESS", "FINANCIAL", "EMPLOYMENT_OR_EDUCATION", "GOVERNMENT"]), country, objectKey: z.string().min(3).max(500), contentSha256: z.string().length(64) }).parse(request.body);
    return reply.code(201).send(await jurisdiction.addRelocationEvidence({ userId: p.userId, requestId: id, ...body }));
  }));

  app.post("/v1/linqasend/admin/jurisdiction/profiles", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const body = z.object({ userId: z.string().uuid(), verifiedCountry: country, regulatoryEntityId: z.string().min(2), nationalityCountry: country.optional(), taxResidenceCountries: z.array(country).default([]) }).parse(request.body);
    const entity = await db.query(`SELECT id FROM linqasend_financial_entities_v7 WHERE id=$1 AND country_code=$2 AND status='ACTIVE' AND due_diligence_status='APPROVED'`, [body.regulatoryEntityId, body.verifiedCountry]);
    if (!entity.rows[0]) throw new Error("REGULATORY_ENTITY_NOT_ELIGIBLE_FOR_PROFILE");
    await db.query(`INSERT INTO user_jurisdiction_profiles_v2(user_id,nationality_country,original_registration_country,verified_residence_country,account_country,tax_residence_countries,regulatory_entity_id,regulatory_jurisdiction,residence_verified_at) VALUES($1,$2,$3,$3,$3,$4,$5,$3,now()) ON CONFLICT(user_id) DO NOTHING`, [body.userId, body.nationalityCountry ?? null, body.verifiedCountry, body.taxResidenceCountries, body.regulatoryEntityId]);
    return reply.code(201).send({ userId: body.userId, jurisdiction: body.verifiedCountry });
  }));

  app.post("/v1/linqasend/admin/jurisdiction/evidence/:id/review", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:review");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ decision: z.enum(["VERIFIED", "REJECTED"]), reasonCode: z.string().min(3).max(120) }).parse(request.body);
    await jurisdiction.reviewEvidence({ evidenceId: id, reviewerId: p.userId, ...body });
    return reply.code(204).send();
  }));

  app.post("/v1/linqasend/admin/jurisdiction/relocations/:id/approve", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ targetRegulatoryEntityId: z.string().min(2), targetCurrency: currency }).parse(request.body);
    await jurisdiction.approveRelocation({ requestId: id, approverId: p.userId, ...body });
    return reply.code(204).send();
  }));

  app.post("/v1/linqasend/admin/regulatory/resolve", guarded(async (request) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:read");
    const body = z.object({ sourceCountry: country, destinationCountry: country, transferClass: z.string(), sourceCurrency: currency, destinationCurrency: currency, fundingMode: z.string(), receiveMode: z.string() }).parse(request.body);
    return regulatory.resolve(body);
  }));

  app.post("/v1/linqasend/admin/capabilities/countries", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const statuses = z.enum(["ENABLED", "CONDITIONAL", "RECEIVE_ONLY", "BANK_OUTBOUND_ONLY", "RESTRICTED", "TEMPORARILY_SUSPENDED", "UNSUPPORTED"]);
    const body = z.object({ country, version: z.number().int().positive(), effectiveFrom: z.coerce.date(), effectiveTo: z.coerce.date().optional(), domesticInternalStatus: statuses, domesticBankInStatus: statuses, domesticBankOutStatus: statuses, domesticMerchantStatus: statuses, domesticRequestMoneyStatus: statuses, crossBorderInboundStatus: statuses, crossBorderOutboundStatus: statuses, crossBorderBankOutboundStatus: statuses, allowedFundingModes: z.array(z.enum(["LINQA_BALANCE", "BANK", "DEBIT_CARD", "CREDIT_CARD", "MOBILE_MONEY"])), allowedReceiveModes: z.array(z.enum(["LINQA_BALANCE", "BANK", "CARD", "MOBILE_MONEY"])), sourceReference: z.string().min(3) }).parse(request.body);
    if (body.effectiveTo && body.effectiveTo <= body.effectiveFrom) throw new Error("INVALID_EFFECTIVE_DATE_RANGE");
    const id = randomUUID();
    await db.query(`INSERT INTO linqasend_country_capabilities_v3(id,country,version,effective_from,effective_to,domestic_internal_status,domestic_bank_in_status,domestic_bank_out_status,domestic_merchant_status,domestic_request_money_status,cross_border_inbound_status,cross_border_outbound_status,cross_border_bank_outbound_status,allowed_funding_modes,allowed_receive_modes,source_reference,approved_by,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())`, [id, body.country, body.version, body.effectiveFrom, body.effectiveTo ?? null, body.domesticInternalStatus, body.domesticBankInStatus, body.domesticBankOutStatus, body.domesticMerchantStatus, body.domesticRequestMoneyStatus, body.crossBorderInboundStatus, body.crossBorderOutboundStatus, body.crossBorderBankOutboundStatus, body.allowedFundingModes, body.allowedReceiveModes, body.sourceReference, p.userId]);
    return reply.code(201).send({ id, version: body.version });
  }));

  app.post("/v1/linqasend/admin/capabilities/corridors", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const body = z.object({ sourceCountry: country, destinationCountry: country, transferClass: z.enum(["INTERNAL_DOMESTIC", "INTERNAL_CROSS_BORDER", "EXTERNAL_DOMESTIC", "EXTERNAL_CROSS_BORDER"]), version: z.number().int().positive(), status: z.enum(["ENABLED", "CONDITIONAL", "RECEIVE_ONLY", "BANK_OUTBOUND_ONLY", "RESTRICTED", "TEMPORARILY_SUSPENDED", "UNSUPPORTED"]), effectiveFrom: z.coerce.date(), effectiveTo: z.coerce.date().optional(), sourceCurrencies: z.array(currency).min(1), destinationCurrencies: z.array(currency).min(1), permittedFundingModes: z.array(z.string()).min(1), permittedReceiveModes: z.array(z.string()).min(1), permittedRails: z.array(z.string()).min(1), minAmountMinor: money.optional(), maxAmountMinor: money.optional(), minKycLevel: z.number().int().nonnegative().optional(), requiresPurposeCode: z.boolean().default(false), requiresSourceOfFunds: z.boolean().default(false), requiresManualReview: z.boolean().default(false), providerId: z.string().min(1).optional(), legalApprovalReference: z.string().min(3), partnerApprovalReference: z.string().min(3) }).parse(request.body);
    if (body.effectiveTo && body.effectiveTo <= body.effectiveFrom) throw new Error("INVALID_EFFECTIVE_DATE_RANGE");
    if (body.minAmountMinor !== undefined && body.maxAmountMinor !== undefined && body.maxAmountMinor < body.minAmountMinor) throw new Error("INVALID_AMOUNT_RANGE");
    const id = randomUUID();
    await db.query(`INSERT INTO linqasend_corridor_rules_v3(id,source_country,destination_country,transfer_class,version,status,effective_from,effective_to,source_currencies,destination_currencies,permitted_funding_modes,permitted_receive_modes,permitted_rails,min_amount_minor,max_amount_minor,min_kyc_level,requires_purpose_code,requires_source_of_funds,requires_manual_review,provider_id,legal_approval_reference,partner_approval_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`, [id, body.sourceCountry, body.destinationCountry, body.transferClass, body.version, body.status, body.effectiveFrom, body.effectiveTo ?? null, body.sourceCurrencies, body.destinationCurrencies, body.permittedFundingModes, body.permittedReceiveModes, body.permittedRails, body.minAmountMinor?.toString() ?? null, body.maxAmountMinor?.toString() ?? null, body.minKycLevel ?? null, body.requiresPurposeCode, body.requiresSourceOfFunds, body.requiresManualReview, body.providerId ?? null, body.legalApprovalReference, body.partnerApprovalReference]);
    return reply.code(201).send({ id, version: body.version });
  }));

  app.post("/v1/linqasend/admin/regulatory/entities", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const body = z.object({ id: z.string().min(2).max(100), legalName: z.string().min(2), displayName: z.string().min(2), entityType: z.string().min(2), countryCode: country, status: z.enum(["DRAFT", "PENDING_DUE_DILIGENCE", "ACTIVE", "RESTRICTED", "SUSPENDED", "TERMINATED", "EXPIRED"]), regulatoryReference: z.string().min(2).optional(), dueDiligenceStatus: z.enum(["NOT_STARTED", "IN_PROGRESS", "APPROVED", "REJECTED", "EXPIRED"]), operationalStatus: z.enum(["HEALTHY", "DEGRADED", "DOWN", "UNKNOWN"]) }).parse(request.body);
    await db.query(`INSERT INTO linqasend_financial_entities_v7(id,legal_name,display_name,entity_type,country_code,status,regulatory_reference,due_diligence_status,operational_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [body.id, body.legalName, body.displayName, body.entityType, body.countryCode, body.status, body.regulatoryReference ?? null, body.dueDiligenceStatus, body.operationalStatus]);
    return reply.code(201).send({ id: body.id });
  }));

  app.post("/v1/linqasend/admin/regulatory/customer-compliance-profiles", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const body = z.object({ userId: z.string().uuid(), verifiedLegalName: z.string().min(2).max(200), verifiedCountry: country, kycLevel: z.number().int().nonnegative(), kycStatus: z.literal("VERIFIED"), providerCustomerRef: z.string().min(3).max(255), verifiedAt: z.coerce.date(), expiresAt: z.coerce.date().optional(), sourceEvidenceRef: z.string().min(3).max(500) }).parse(request.body);
    if (body.expiresAt && body.expiresAt <= body.verifiedAt) throw new Error("INVALID_KYC_VALIDITY_RANGE");
    await db.query(`INSERT INTO linqasend_customer_compliance_profiles_v7(user_id,verified_legal_name,verified_country,kyc_level,kyc_status,provider_customer_ref,verified_at,expires_at,source_evidence_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id) DO UPDATE SET verified_legal_name=excluded.verified_legal_name,verified_country=excluded.verified_country,kyc_level=excluded.kyc_level,kyc_status=excluded.kyc_status,provider_customer_ref=excluded.provider_customer_ref,verified_at=excluded.verified_at,expires_at=excluded.expires_at,source_evidence_ref=excluded.source_evidence_ref,updated_at=now()`, [body.userId, body.verifiedLegalName, body.verifiedCountry, body.kycLevel, body.kycStatus, body.providerCustomerRef, body.verifiedAt, body.expiresAt ?? null, body.sourceEvidenceRef]);
    return reply.code(201).send({ userId: body.userId, kycStatus: body.kycStatus });
  }));

  app.post("/v1/linqasend/admin/regulatory/contracts", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const body = z.object({ id: z.string().min(2).max(100), entityId: z.string().min(2), contractSetId: z.string().min(2), status: z.enum(["DRAFT", "ACTIVE", "SUSPENDED", "EXPIRED", "TERMINATED"]), responsibilities: z.array(z.string()).min(1), sourceCountries: z.array(country).default([]), destinationCountries: z.array(country).default([]), currencies: z.array(currency).default([]), effectiveFrom: z.coerce.date(), effectiveTo: z.coerce.date().optional(), executedDocumentRef: z.string().min(3) }).parse(request.body);
    if (body.effectiveTo && body.effectiveTo <= body.effectiveFrom) throw new Error("INVALID_EFFECTIVE_DATE_RANGE");
    await db.query(`INSERT INTO linqasend_partner_contracts_v7(id,entity_id,contract_set_id,status,responsibilities,source_countries,destination_countries,currencies,effective_from,effective_to,executed_document_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [body.id, body.entityId, body.contractSetId, body.status, body.responsibilities, body.sourceCountries, body.destinationCountries, body.currencies, body.effectiveFrom, body.effectiveTo ?? null, body.executedDocumentRef]);
    return reply.code(201).send({ id: body.id });
  }));

  app.post("/v1/linqasend/admin/regulatory/responsibility-maps", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const body = z.object({ sourceCountry: country, destinationCountry: country, transferClass: z.string(), sourceCurrency: currency, destinationCurrency: currency, fundingMode: z.string(), receiveMode: z.string(), custodyModel: z.enum(["NO_CUSTOMER_FUNDS", "PARTNER_CUSTODY", "FBO_OR_EQUIVALENT_PARTNER_ACCOUNT", "PARTNER_ISSUED_STORED_VALUE", "PASS_THROUGH_ONLY"]), responsibilityEntities: z.record(z.string(), z.string().min(2)), legalApprovalReference: z.string().min(3), partnerApprovalReference: z.string().min(3), contractSetId: z.string().min(2), policyVersion: z.number().int().positive(), effectiveFrom: z.coerce.date(), effectiveTo: z.coerce.date().optional(), status: z.enum(["DRAFT", "ACTIVE", "RESTRICTED", "SUSPENDED", "EXPIRED"]) }).parse(request.body);
    if (body.effectiveTo && body.effectiveTo <= body.effectiveFrom) throw new Error("INVALID_EFFECTIVE_DATE_RANGE");
    const { rows } = await db.query(`INSERT INTO linqasend_financial_responsibility_maps_v7(source_country,destination_country,transfer_class,source_currency,destination_currency,funding_mode,receive_mode,custody_model,responsibility_entities,legal_approval_reference,partner_approval_reference,contract_set_id,policy_version,effective_from,effective_to,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`, [body.sourceCountry, body.destinationCountry, body.transferClass, body.sourceCurrency, body.destinationCurrency, body.fundingMode, body.receiveMode, body.custodyModel, JSON.stringify(body.responsibilityEntities), body.legalApprovalReference, body.partnerApprovalReference, body.contractSetId, body.policyVersion, body.effectiveFrom, body.effectiveTo ?? null, body.status]);
    return reply.code(201).send({ id: rows[0].id });
  }));

  app.get("/v1/linqasend/admin/money-operations", guarded(async (request) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:read");
    return settlement.dashboard();
  }));

  app.post("/v1/linqasend/admin/reconciliation/runs", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:review");
    const body = z.object({ sourceType: z.enum(["BANK", "PROVIDER"]), sourceId: z.string().min(1).max(200), from: z.coerce.date(), to: z.coerce.date() }).parse(request.body);
    return reply.code(202).send(await settlement.reconcile(body.sourceType, body.sourceId, body.from, body.to));
  }));

  app.post("/v1/linqasend/admin/settlement/batches/items", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:review");
    const body = z.object({ instructionId: z.string().uuid(), providerId: z.string().min(1).max(120), currency, settlementDate: z.coerce.date(), batchType: z.enum(["FUNDING", "PAYOUT", "REFUND", "CHARGEBACK", "FEE", "RESERVE"]) }).parse(request.body);
    return reply.code(201).send(await settlement.addInstructionToBatch(body));
  }));

  app.post("/v1/linqasend/admin/settlement/batches/:id/seal", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return reply.send(await settlement.sealBatch(id));
  }));

  app.post("/v1/linqasend/admin/settlement/batches/:id/submit", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ providerReference: z.string().min(3).max(255) }).parse(request.body);
    await settlement.markBatchSubmitted(id, body.providerReference);
    return reply.code(202).send({ id, status: "SUBMITTED" });
  }));

  app.post("/v1/linqasend/admin/reconciliation/breaks/:id/suspense", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:review");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return reply.code(201).send(await settlement.openSuspenseForBreak(id));
  }));

  app.post("/v1/linqasend/admin/reconciliation/breaks/:id/resolve", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ resolutionCode: z.string().min(3).max(80), notes: z.string().min(3).max(2000) }).parse(request.body);
    await settlement.resolveBreak({ breakId: id, actorId: p.userId, ...body });
    return reply.code(204).send();
  }));

  app.post("/v1/linqasend/admin/money-adjustments", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:review");
    const body = z.object({ transferId: z.string().uuid(), type: z.enum(["FULL_REFUND", "REVERSAL"]), reasonCode: z.string().min(3).max(120), notes: z.string().max(2000).optional() }).parse(request.body);
    return reply.code(202).send(await settlement.requestMoneyAdjustment({ transferId: body.transferId, type: body.type, reasonCode: body.reasonCode, requestedBy: p.userId, ...(body.notes !== undefined ? { notes: body.notes } : {}) }));
  }));

  app.post("/v1/linqasend/admin/money-adjustments/:actionId/approve", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const { actionId } = z.object({ actionId: z.string().uuid() }).parse(request.params);
    return reply.send(await settlement.approveAndExecuteMoneyAdjustment(actionId, p.userId));
  }));

  app.post("/v1/linqasend/admin/treasury/actions", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:review");
    const body = z.object({ actionType: z.enum(["MOVE_LIQUIDITY", "TOP_UP_PREFUND", "REDUCE_PREFUND", "OPEN_FX_POSITION", "CLOSE_FX_POSITION", "REBALANCE", "RELEASE_RESERVE"]), currency, amountMinor: money, reasonCode: z.string().min(3).max(120), metadata: z.record(z.string(), z.unknown()).optional() }).parse(request.body);
    return reply.code(202).send(await settlement.requestTreasuryAction({ actionType: body.actionType, currency: body.currency, amountMinor: body.amountMinor, reasonCode: body.reasonCode, requestedBy: p.userId, ...(body.metadata !== undefined ? { metadata: body.metadata } : {}) }));
  }));

  app.post("/v1/linqasend/admin/treasury/actions/:id/approve", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await settlement.approveTreasuryAction(id, p.userId);
    return reply.code(204).send();
  }));

  app.post("/v1/linqasend/admin/eod", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const body = z.object({ controlDate: z.coerce.date(), currencies: z.array(currency).min(1).max(50) }).parse(request.body);
    return reply.code(201).send(await settlement.runEndOfDay(body.controlDate, body.currencies));
  }));

  app.post("/v1/linqasend/admin/ingestion/bank-csv", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:review");
    const body = z.object({ sourceAccountId: z.string().min(1).max(200), content: z.string().min(1).max(10 * 1024 * 1024) }).parse(request.body);
    return reply.code(202).send(await closure.ingestBankStatement({ ...body, uploadedBy: p.userId }));
  }));

  app.post("/v1/linqasend/admin/certification/evidence", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const body = z.object({ subjectType: z.string().min(1), subjectId: z.string().min(1), gitSha: z.string().length(40), artifactDigest: z.string().min(16), items: z.array(z.object({ kind: z.string(), uri: z.string(), sha256: z.string().length(64), capturedAt: z.string().datetime(), expiresAt: z.string().datetime().optional(), metadata: z.record(z.string(), z.unknown()).optional() })).min(1) }).parse(request.body);
    return reply.code(201).send(await closure.bindEvidence({ subjectType: body.subjectType, subjectId: body.subjectId, gitSha: body.gitSha, artifactDigest: body.artifactDigest, items: body.items.map((item) => ({ kind: item.kind, uri: item.uri, sha256: item.sha256, capturedAt: item.capturedAt, ...(item.expiresAt !== undefined ? { expiresAt: item.expiresAt } : {}), ...(item.metadata !== undefined ? { metadata: item.metadata } : {}) })), createdBy: p.userId }));
  }));

  app.post("/v1/linqasend/admin/certification/physical-runs", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const body = z.object({ corridorRuleId: z.string().uuid(), providerId: z.string().min(1), gitSha: z.string().length(40), environment: z.string().min(2), evidenceManifestId: z.string().uuid(), testCases: z.array(z.object({ case: z.string(), passed: z.boolean(), mock: z.boolean(), providerReference: z.string().optional(), evidenceSha256: z.string().length(64) })).min(1) }).parse(request.body);
    const testCases = body.testCases.map((test) => ({ case: test.case, passed: test.passed, mock: test.mock, evidenceSha256: test.evidenceSha256, ...(test.providerReference !== undefined ? { providerReference: test.providerReference } : {}) }));
    return reply.code(201).send(await closure.recordPhysicalCertification({ ...body, testCases }));
  }));

  app.post("/v1/linqasend/admin/certification/providers", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const body = z.object({ providerId: z.string().min(1), gitSha: z.string().length(40), adapterVersion: z.string().min(1), evidenceManifestId: z.string().uuid(), expiresAt: z.coerce.date() }).parse(request.body);
    return reply.code(201).send(await closure.certifyProvider({ ...body, certifiedBy: p.userId }));
  }));

  app.post("/v1/linqasend/admin/certification/corridors", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const body = z.object({ corridorRuleId: z.string().uuid(), gitSha: z.string().length(40), evidenceManifestId: z.string().uuid(), expiresAt: z.coerce.date(), failureTestsPassed: z.boolean() }).parse(request.body);
    return reply.code(201).send(await closure.certifyCorridor({ ...body, certifiedBy: p.userId }));
  }));

  app.post("/v1/linqasend/admin/certification/releases", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:review");
    const body = z.object({ releaseVersion: z.string().min(1), gitSha: z.string().length(40), artifactDigest: z.string().length(64), environment: z.string().min(2), corridorIds: z.array(z.string().uuid()).min(1), providerIds: z.array(z.string()).min(1) }).parse(request.body);
    return reply.code(201).send(await closure.createReleaseManifest({ ...body, createdBy: p.userId }));
  }));

  app.post("/v1/linqasend/admin/certification/releases/:id/signoff", guarded(async (request) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ role: z.enum(["OPERATIONS", "COMPLIANCE"]) }).parse(request.body);
    return closure.signOffRelease({ id, actorId: p.userId, role: body.role });
  }));

  app.post("/v1/linqasend/admin/certification/ga-gate", guarded(async (request, reply) => {
    const p = await auth(request); requireScope(p, "ops:linqasend:approve");
    const body = z.object({ gitSha: z.string().length(40), artifactDigest: z.string().min(16), corridorIds: z.array(z.string().uuid()), environment: z.string().min(2).max(40) }).parse(request.body);
    const result = await closure.evaluateGaGate({ ...body, evaluatedBy: p.userId });
    return reply.code(result.allowed ? 200 : 409).send(result);
  }));

  app.post("/v1/linqasend/admin/launch/cohorts", guarded(async(request,reply)=>{const p=await auth(request);requireScope(p,"ops:linqasend:approve");const body=z.object({name:z.string().min(3).max(120),corridorRuleIds:z.array(z.string().uuid()).min(1),perTransferLimitMinor:money,dailyUserLimitMinor:money}).parse(request.body);return reply.code(201).send(await launch.createCohort(body));}));
  app.post("/v1/linqasend/admin/launch/cohorts/:id/members", guarded(async(request,reply)=>{const p=await auth(request);requireScope(p,"ops:linqasend:approve");const{id}=z.object({id:z.string().uuid()}).parse(request.params);const body=z.object({userId:z.string().uuid()}).parse(request.body);await launch.enroll(id,body.userId,p.userId);return reply.code(204).send();}));
  app.post("/v1/linqasend/admin/launch/approval-requests", guarded(async(request,reply)=>{const p=await auth(request);requireScope(p,"ops:linqasend:approve");const body=z.object({cohortId:z.string().uuid(),releaseManifestId:z.string().uuid()}).parse(request.body);return reply.code(201).send(await launch.requestApproval(body.cohortId,body.releaseManifestId,p.userId));}));
  app.post("/v1/linqasend/admin/launch/approval-requests/:id/decisions", guarded(async(request,reply)=>{const p=await auth(request);requireScope(p,"ops:linqasend:approve");const{id}=z.object({id:z.string().uuid()}).parse(request.params);const body=z.object({role:z.enum(["ENGINEERING","SECURITY","FRAUD","COMPLIANCE","FINANCE","OPERATIONS"]),decision:z.enum(["APPROVE","REJECT"]),evidenceReference:z.string().min(8).max(500)}).parse(request.body);await launch.decide(id,body.role,p.userId,body.decision,body.evidenceReference);return reply.code(204).send();}));
  app.post("/v1/linqasend/admin/launch/cohorts/:id/activate", guarded(async(request)=>{const p=await auth(request);requireScope(p,"ops:linqasend:approve");const{id}=z.object({id:z.string().uuid()}).parse(request.params);return launch.activate(id);}));
  app.patch("/v1/linqasend/admin/kill-switches/:scopeType/:scopeId", guarded(async(request,reply)=>{const p=await auth(request);requireScope(p,"ops:linqasend:approve");const params=z.object({scopeType:z.enum(["GLOBAL","CORRIDOR","PROVIDER","RAIL","COHORT"]),scopeId:z.string().min(1).max(100)}).parse(request.params);const body=z.object({active:z.boolean(),reason:z.string().min(8).max(500)}).parse(request.body);const current=await db.query(`SELECT activated_by FROM linqasend_kill_switches WHERE scope_type=$1 AND scope_id=$2`,[params.scopeType,params.scopeId]);if(body.active===false&&current.rows[0]?.activated_by===p.userId)throw new Error("KILL_SWITCH_CLEAR_REQUIRES_INDEPENDENT_APPROVER");await db.query(`INSERT INTO linqasend_kill_switches(scope_type,scope_id,active,reason,activated_by,activated_at,cleared_by,cleared_at) VALUES($1,$2,$3,$4,CASE WHEN $3 THEN $5 ELSE NULL END,CASE WHEN $3 THEN now() ELSE NULL END,CASE WHEN NOT $3 THEN $5 ELSE NULL END,CASE WHEN NOT $3 THEN now() ELSE NULL END) ON CONFLICT(scope_type,scope_id) DO UPDATE SET active=excluded.active,reason=excluded.reason,activated_by=CASE WHEN excluded.active THEN $5 ELSE linqasend_kill_switches.activated_by END,activated_at=CASE WHEN excluded.active THEN now() ELSE linqasend_kill_switches.activated_at END,cleared_by=CASE WHEN NOT excluded.active THEN $5 ELSE NULL END,cleared_at=CASE WHEN NOT excluded.active THEN now() ELSE NULL END`,[params.scopeType,params.scopeId,body.active,body.reason,p.userId]);return reply.code(204).send();}));
  app.get("/v1/linqasend/admin/readiness", guarded(async(request)=>{const p=await auth(request);requireScope(p,"ops:linqasend:read");const[snapshots,workers,kills,alerts]=await Promise.all([db.query(`SELECT * FROM linqasend_readiness_snapshots ORDER BY evaluated_at DESC LIMIT 50`),db.query(`SELECT worker_name,instance_id,status,last_heartbeat_at,details FROM linqasend_worker_heartbeats ORDER BY worker_name`),db.query(`SELECT * FROM linqasend_kill_switches WHERE active=true`),db.query(`SELECT severity,alert_type,subject_type,subject_id,details,created_at FROM linqasend_operational_alerts WHERE status='OPEN' ORDER BY created_at DESC LIMIT 100`)]);return{realMoneyEnabled:config.LINQASEND_REAL_MONEY_ENABLED===true,mode:config.LINQASEND_MODE??"SANDBOX_CERTIFICATION",snapshots:snapshots.rows,workers:workers.rows,activeKillSwitches:kills.rows,openAlerts:alerts.rows};}));
}
