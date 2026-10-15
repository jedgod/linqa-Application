import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { createActiveAuthenticator } from "../auth/active-principal.js";
import type { Database } from "../db/pool.js";
import type { VaultAdapters } from "../integrations/vault/contracts.js";
import { currentVaultIntegrationStatus, safeDefaultVaultAdapters } from "../integrations/vault/safe-default.adapters.js";
import { beginUploadWithIntegrations } from "../integrations/vault/close-existing-upload.js";
import type { FileVaultService } from "../services/file-vault.service.js";
import type { BiometricAuthorizationService } from "../security/biometrics/service.js";
import { biometricPrincipal } from "./biometrics.js";

const base64Bytes = () =>
  z.string().base64().transform((value) => Buffer.from(value, "base64"));

export async function registerFileVaultRoutes(
  app: FastifyInstance,
  config: AppConfig,
  fileVault: FileVaultService,
  vaultAdapters: VaultAdapters = safeDefaultVaultAdapters(),
  biometrics?: BiometricAuthorizationService,
  db?: Database
) {
  if (config.NODE_ENV === "production" && !db) throw new Error("VAULT_AUTHORIZATION_DATABASE_REQUIRED");
  const authenticate = db ? createActiveAuthenticator(config, db) : createAuthenticator(config);

  /**
   * Single source of truth for which vault capabilities are genuinely
   * wired up right now — replaces hand-written "not connected" strings in
   * `FileVaultPage.tsx` with one server-reported status object.
   */
  app.get("/v1/vault/integration-status", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "vault:read");
      return reply.code(200).send(currentVaultIntegrationStatus(vaultAdapters));
    } catch (error) {
      request.log.warn({ err: error }, "vault integration-status request rejected");
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.post("/v1/vault/items", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "vault:write");

      const body = z.object({
        itemType: z.enum(["DOCUMENT", "IDENTITY", "PHOTO", "RECOVERY", "OTHER"]),
        nameCiphertextBase64: base64Bytes(),
        metadataCiphertextBase64: base64Bytes(),
        keyEnvelopeBase64: base64Bytes(),
        contentHashBase64: base64Bytes(),
        encryptedSize: z.number().int().positive(),
        contentType: z.string().min(1).max(200)
      }).parse(request.body);

      const result = await beginUploadWithIntegrations(fileVault, vaultAdapters, {
        userId: principal.userId,
        itemType: body.itemType,
        nameCiphertext: body.nameCiphertextBase64,
        metadataCiphertext: body.metadataCiphertextBase64,
        keyEnvelope: body.keyEnvelopeBase64,
        contentHash: body.contentHashBase64,
        encryptedSize: body.encryptedSize,
        contentType: body.contentType
      });

      return reply.code(201).send(result);
    } catch (error) {
      request.log.warn({ err: error }, "vault item creation rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.get("/v1/vault/items", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "vault:read");
      const items = await fileVault.list(principal.userId);
      return reply.code(200).send({ items });
    } catch (error) {
      request.log.warn({ err: error }, "vault item listing rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.get("/v1/vault/private/items", async (request,reply) => {
    try {
      const p = await authenticate(request); requireScope(p,"vault:read");
      const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(request.headers["x-vault-unlock-token"]);
      if (!biometrics) throw new Error("BIOMETRIC_NOT_CONFIGURED");
      await biometrics.assertVaultSession(biometricPrincipal(p,request),token);
      return { items: await fileVault.list(p.userId,true) };
    } catch { return reply.code(403).send({ error: "PRIVATE_VAULT_UNLOCK_REQUIRED" }); }
  });

  app.get("/v1/vault/items/:itemId/download", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "vault:read");

      const params = z.object({
        itemId: z.string().uuid()
      }).parse(request.params);

      if (await fileVault.isPrivateItem(principal.userId,params.itemId)) {
        if (!biometrics) throw new Error("BIOMETRIC_NOT_CONFIGURED");
        const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(request.headers["x-vault-unlock-token"]);
        await biometrics.assertVaultSession(biometricPrincipal(principal,request),token);
      }

      const download = await fileVault.download(principal.userId, params.itemId);
      return reply.code(200).send(download);
    } catch (error) {
      request.log.warn({ err: error }, "vault item download rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}
