import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { intakeConfigured, unconfiguredIntakeAdapters, type ImportKind, type IntakeAdapters } from "../integrations/vault/intake-adapters.js";
import { LivePlatformSecurity, LiveStepUp, LiveUserDirectory } from "../integrations/vault/live-platform-adapters.js";
import { providerFlags, unconfiguredProviders, type VaultProviders } from "../integrations/vault/production-contracts.js";
import type { StepUpVerifier } from "../security/step-up.js";
import type { BiometricAuthorizationService } from "../security/biometrics/service.js";
import { biometricPrincipal } from "./biometrics.js";
import { VaultError } from "../services/vault-access.js";
import { VaultBillingService } from "../services/vault-billing.service.js";
import { VaultFilesService } from "../services/vault-files.service.js";
import { VaultIntakeError, VaultIntakeService } from "../services/vault-intake.service.js";
import { vaultFeatureOff, vaultReadiness, type Env } from "../services/vault-operations.js";
import { VaultSecurityCenterService } from "../services/vault-security-center.service.js";
import { VaultShareService } from "../services/vault-share.service.js";

export interface VaultRouteDeps {
  intakeAdapters?: IntakeAdapters;
  providers?: Partial<VaultProviders>;
  stepUp?: StepUpVerifier;
  /** Owns Private Vault unlock and lock (routes/biometrics.ts). Without it, PRIVATE objects are never listed. */
  biometrics?: BiometricAuthorizationService | undefined;
  env?: Env;
  publicBaseUrl?: string | undefined;
  checkoutReturnOrigins?: string[];
}

const kinds = z.enum(["message", "client", "external_link", "scan_document"]);

/**
 * Vault folders, imports (Social, Message, Client, External link, Scan), My Files, sharing,
 * Private Vault sessions, Security Center and plan changes (Vault v1.0 to v7.0).
 *
 * The caller's workspace comes from the signed-in user, never from the request body. Every
 * provider (storage, scanner, mail, billing, social) is "unconfigured" unless injected, and an
 * unconfigured provider makes its feature answer 503 instead of pretending to work. The Vault
 * content key is never seen here: imports reach the Vault only as ciphertext the device uploads.
 */
export async function registerVaultIntakeRoutes(app: FastifyInstance, config: AppConfig, db: Database, deps: VaultRouteDeps = {}) {
  const authenticate = createAuthenticator(config);
  const env = deps.env ?? process.env;
  const adapters = deps.intakeAdapters ?? unconfiguredIntakeAdapters();

  const platform = deps.providers?.platform ?? new LivePlatformSecurity(db);
  const stepUp = deps.providers?.stepUp ?? new LiveStepUp(deps.stepUp ?? { verifyAndConsume: async () => { throw new Error("STEP_UP_NOT_CONFIGURED"); } });
  const providers: VaultProviders = {
    ...unconfiguredProviders({ stepUp, platform, users: deps.providers?.users ?? new LiveUserDirectory(db) }),
    ...deps.providers,
    stepUp,
    platform
  };

  const intake = new VaultIntakeService(db, adapters, providers);
  const files = new VaultFilesService(db);
  const share = new VaultShareService(db, { users: providers.users, mail: providers.mail, social: providers.socialCopy, stepUp: providers.stepUp, ciphertext: providers.ciphertext, publicBaseUrl: deps.publicBaseUrl ?? env.VAULT_PUBLIC_BASE_URL });
  const billing = new VaultBillingService(db, providers.billing, deps.checkoutReturnOrigins ?? (env.VAULT_CHECKOUT_RETURN_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const flags = () => ({ scanner: adapters.scanner.name !== "unconfigured", sharing: providerFlags(providers).sharing, email: providerFlags(providers).email, socialImport: intakeConfigured(adapters), socialExport: providerFlags(providers).socialExport, billing: providerFlags(providers).billing });
  const security = new VaultSecurityCenterService(db, providers.platform, flags);

  interface Ctx { userId: string; deviceId: string | undefined; requestId: string }
  type Feature = "INTAKE" | "SHARING" | "SOCIAL_EXPORT" | "BILLING";

  function guarded(scope: "vault:read" | "vault:write", feature: Feature | null, handler: (request: FastifyRequest, reply: FastifyReply, ctx: Ctx) => Promise<unknown>) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      let ctx: Ctx;
      try {
        const principal = await authenticate(request);
        requireScope(principal, scope);
        ctx = { userId: principal.userId, deviceId: principal.deviceId, requestId: request.id };
      } catch (error) {
        request.log.warn({ err: error }, "vault request unauthorized");
        return reply.code(401).send({ error: "unauthorized" });
      }
      const off = feature ? vaultFeatureOff(env, feature) : null;
      if (off) return reply.code(503).send({ error: off });
      try {
        return await handler(request, reply, ctx);
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(422).send({ error: "validation_error" });
        if (error instanceof VaultIntakeError || error instanceof VaultError) return reply.code(error.status).send({ error: error.code });
        request.log.error({ err: error }, "vault request failed");
        return reply.code(500).send({ error: "internal_error" });
      }
    };
  }
  const needDevice = (ctx: Ctx): string => {
    if (!ctx.deviceId) throw new VaultError("DEVICE_BOUND_TOKEN_REQUIRED", 401);
    return ctx.deviceId;
  };
  const workspaceId = z.string().uuid().optional();
  const objectId = z.string().uuid();

  // ---- capabilities, plans, folders --------------------------------------------------------
  app.get("/v1/vault/intake/capabilities", guarded("vault:read", null, async () => ({ ...flags() })));
  app.get("/v1/vault/plans", guarded("vault:read", null, async (_r, _p, ctx) => ({ ...(await intake.listPlans(ctx.userId)), billingAvailable: providerFlags(providers).billing })));
  app.get("/v1/vault/folders", guarded("vault:read", null, async (_r, _p, ctx) => ({ folders: await intake.listFolders(ctx.userId) })));
  app.post("/v1/vault/folders", guarded("vault:write", null, async (request, reply, ctx) => {
    const body = z.object({ name: z.string().min(1).max(255), parentId: z.string().uuid().nullish() }).strict().parse(request.body);
    return reply.code(201).send(await intake.createFolder(ctx.userId, body));
  }));

  // ---- My Files ------------------------------------------------------------------------------
  app.get("/v1/vault/files", guarded("vault:read", null, async (request, _r, ctx) => {
    const q = z.object({ workspaceId, folderId: z.string().uuid().optional(), tag: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(100).optional(), cursor: z.string().max(100).optional() }).parse(request.query);
    // PRIVATE objects need the unlock token from a biometric unlock on this device.
    let includePrivate = false;
    const token = request.headers["x-vault-unlock-token"];
    if (token !== undefined) {
      if (typeof token !== "string" || !deps.biometrics) throw new VaultError("PRIVATE_VAULT_UNLOCK_REQUIRED", 403);
      try {
        await deps.biometrics.assertVaultSession(biometricPrincipal(await authenticate(request), request), token);
      } catch {
        throw new VaultError("PRIVATE_VAULT_UNLOCK_REQUIRED", 403);
      }
      includePrivate = true;
    }
    return files.list(ctx.userId, { ...q, includePrivate });
  }));

  // ---- imports -------------------------------------------------------------------------------
  const startImport = (kind: ImportKind, sourceRef: string, folderId: string | null | undefined, consent: boolean, ctx: Ctx, request: FastifyRequest) =>
    intake.requestImport(ctx.userId, { kind, sourceRef, folderId, plaintextInspectionConsent: consent }).then((created) => {
      // Processing runs after the response. Its outcome is read from the status endpoint.
      setImmediate(() => {
        intake.process(created.importId).catch((error) => request.log.error({ err: error, importId: created.importId }, "vault import processing failed"));
      });
      return created;
    });

  app.post("/v1/vault/imports/social", guarded("vault:write", "INTAKE", async (request, reply, ctx) => {
    const body = z.object({ sourceAttachmentId: z.string().min(1).max(200), folderId: z.string().uuid().nullish(), plaintextInspectionConsent: z.boolean().default(false) }).strict().parse(request.body);
    const created = await startImport("SOCIAL", body.sourceAttachmentId, body.folderId, body.plaintextInspectionConsent, ctx, request);
    return reply.code(202).send({ importId: created.importId, status: created.state });
  }));

  app.post("/v1/vault/imports/:kind", guarded("vault:write", "INTAKE", async (request, reply, ctx) => {
    const { kind } = z.object({ kind: kinds }).parse(request.params);
    const body = z.object({ sourceRef: z.string().min(1).max(2000), folderId: z.string().uuid().nullish(), plaintextInspectionConsent: z.boolean().default(false) }).strict().parse(request.body);
    const created = await startImport(kind.toUpperCase() as ImportKind, body.sourceRef, body.folderId, body.plaintextInspectionConsent, ctx, request);
    return reply.code(202).send({ importId: created.importId, status: created.state });
  }));

  app.get("/v1/vault/imports/:id/status", guarded("vault:read", null, async (request, _r, ctx) => intake.getStatus(ctx.userId, z.object({ id: z.string().uuid() }).parse(request.params).id)));

  // Deployed clients call confirm. It no longer moves plaintext into the Vault: it hands the clean copy
  // to this device, which must encrypt it and upload ciphertext (see finalize-ciphertext).
  const handoff = guarded("vault:write", "INTAKE", async (request, _r, ctx) => intake.handoff(ctx.userId, needDevice(ctx), z.object({ id: z.string().uuid() }).parse(request.params).id));
  app.post("/v1/vault/imports/:id/handoff", handoff);
  app.post("/v1/vault/imports/:id/confirm", handoff);

  app.post("/v1/vault/imports/:id/ciphertext-upload", guarded("vault:write", "INTAKE", async (request, _r, ctx) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ objectId, size: z.number().int().positive().max(300 * 1024 * 1024), mediaType: z.string().min(1).max(200) }).strict().parse(request.body);
    needDevice(ctx);
    return intake.createCiphertextUpload(ctx.userId, id, body);
  }));

  app.post("/v1/vault/imports/:id/finalize-ciphertext", guarded("vault:write", "INTAKE", async (request, _r, ctx) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ handoffToken: z.string().min(20).max(200), objectId, ciphertextSize: z.number().int().positive(), encryptedMetadata: z.record(z.string(), z.unknown()), tags: z.array(z.string().max(64)).max(20).optional() }).strict().parse(request.body);
    return intake.finalizeCiphertext(ctx.userId, needDevice(ctx), id, body, ctx.requestId);
  }));

  // ---- sharing -------------------------------------------------------------------------------
  app.post("/v1/vault/share/linqa-user", guarded("vault:write", "SHARING", async (request, reply, ctx) => {
    const body = z.object({ workspaceId, objectId, recipient: z.string().min(1).max(100) }).strict().parse(request.body);
    return reply.code(201).send(await share.linqaUser(ctx.userId, body));
  }));
  app.post("/v1/vault/share/vault-to-vault", guarded("vault:write", "SHARING", async (request, reply, ctx) => {
    const body = z.object({ workspaceId, objectId, destinationWorkspaceId: z.string().uuid(), recipient: z.string().min(1).max(100) }).strict().parse(request.body);
    return reply.code(201).send(await share.vaultToVault(ctx.userId, body));
  }));
  app.get("/v1/vault/share/transfers/incoming", guarded("vault:read", null, async (_r, _p, ctx) => share.incomingTransfers(ctx.userId)));
  app.post("/v1/vault/share/transfers/:id/respond", guarded("vault:write", "SHARING", async (request, _r, ctx) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ accept: z.boolean() }).strict().parse(request.body);
    return share.respondToTransfer(ctx.userId, id, body.accept);
  }));
  app.post("/v1/vault/share/transfers/:id/revoke", guarded("vault:write", "SHARING", async (request, _r, ctx) => share.revokeTransfer(ctx.userId, z.object({ id: z.string().uuid() }).parse(request.params).id)));
  app.post("/v1/vault/share/secure-links", guarded("vault:write", "SHARING", async (request, reply, ctx) => {
    const body = z.object({ workspaceId, objectId, expiresMinutes: z.number().int().min(1).max(10_080), maxDownloads: z.number().int().min(1).max(1000).optional(), requireAuth: z.boolean().optional() }).strict().parse(request.body);
    return reply.code(201).send(await share.secureLink(ctx.userId, body));
  }));
  app.delete("/v1/vault/share/secure-links/:id", guarded("vault:write", "SHARING", async (request, _r, ctx) => share.revokeLink(ctx.userId, z.object({ id: z.string().uuid() }).parse(request.params).id)));
  app.post("/v1/vault/share/email", guarded("vault:write", "SHARING", async (request, reply, ctx) => {
    const body = z.object({ workspaceId, objectId, email: z.string().email().max(320), expiresMinutes: z.number().int().min(1).max(10_080) }).strict().parse(request.body);
    return reply.code(202).send(await share.email(ctx.userId, body));
  }));
  // Opening a link. Sign-in is checked only for links that require it.
  app.get("/v1/vault/share/links/:token", async (request, reply) => {
    const off = vaultFeatureOff(env, "SHARING");
    if (off) return reply.code(503).send({ error: off });
    let viewer: string | null = null;
    try { viewer = (await authenticate(request)).userId; } catch { viewer = null; }
    try {
      return await share.resolveLink(z.object({ token: z.string().min(20).max(200) }).parse(request.params).token, viewer);
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(404).send({ error: "LINK_UNAVAILABLE" });
      if (error instanceof VaultError) return reply.code(error.status).send({ error: error.code });
      request.log.error({ err: error }, "vault link resolve failed");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.post("/v1/vault/exports/social/authorize", guarded("vault:write", "SOCIAL_EXPORT", async (request, reply, ctx) => {
    const body = z.object({ workspaceId, objectId, proof: z.string().min(10).max(4000), destinationRef: z.string().max(200).optional() }).strict().parse(request.body);
    return reply.code(201).send(await share.authorizeSocial(ctx.userId, needDevice(ctx), body, ctx.requestId));
  }));
  app.post("/v1/vault/exports/social/:grantId/execute", guarded("vault:write", "SOCIAL_EXPORT", async (request, _r, ctx) => share.executeSocial(ctx.userId, z.object({ grantId: z.string().uuid() }).parse(request.params).grantId, ctx.requestId)));

  // Private Vault unlock and lock live in routes/biometrics.ts (hardware-backed biometric keys).

  // ---- security center -----------------------------------------------------------------------
  app.get("/v1/vault/security-center", guarded("vault:read", null, async (_r, _p, ctx) => security.get(ctx.userId)));
  app.put("/v1/vault/security-center/login-alerts", guarded("vault:write", null, async (request, _r, ctx) => security.setLoginAlerts(ctx.userId, z.object({ enabled: z.boolean() }).strict().parse(request.body).enabled)));

  // ---- billing -------------------------------------------------------------------------------
  app.post("/v1/vault/billing/checkout", guarded("vault:write", "BILLING", async (request, reply, ctx) => {
    const body = z.object({ workspaceId, planCode: z.string().min(1).max(40), successUrl: z.string().url().max(2000), cancelUrl: z.string().url().max(2000), idempotencyKey: z.string().min(8).max(100) }).strict().parse(request.body);
    return reply.code(201).send(await billing.checkout(ctx.userId, body));
  }));
  // The provider signs the exact bytes it sends, so this route keeps the body unparsed.
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    scope.post("/v1/vault/billing/webhook", async (request, reply) => {
      const off = vaultFeatureOff(env, "BILLING");
      if (off) return reply.code(503).send({ error: off });
      const signature = typeof request.headers["x-provider-signature"] === "string" ? request.headers["x-provider-signature"] : "";
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "WEBHOOK_BODY_INVALID" });
      try {
        return await billing.webhook(request.body, signature);
      } catch (error) {
        if (error instanceof VaultError) return reply.code(error.status).send({ error: error.code });
        request.log.error({ err: error }, "vault billing webhook failed");
        return reply.code(500).send({ error: "internal_error" });
      }
    });
  });

  // ---- release readiness ---------------------------------------------------------------------
  app.get("/internal/ready/vault", async (_request, reply) => {
    const result = await vaultReadiness(db, env, async () => { await db.query("SELECT 1"); await db.query("SELECT 1 FROM devices LIMIT 1"); await db.query("SELECT 1 FROM webauthn_credentials LIMIT 1"); return true; });
    return reply.code(result.ready ? 200 : 503).send(env.NODE_ENV === "production" ? { ready: result.ready } : result);
  });
}
