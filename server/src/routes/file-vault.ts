import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator } from "../auth/jwt.js";
import type { VaultAdapters } from "../integrations/vault/contracts.js";
import { currentVaultIntegrationStatus, safeDefaultVaultAdapters } from "../integrations/vault/safe-default.adapters.js";
import type { FileVaultService } from "../services/file-vault.service.js";

const base64Bytes = () =>
  z.string().base64().transform((value) => Buffer.from(value, "base64"));

export async function registerFileVaultRoutes(
  app: FastifyInstance,
  config: AppConfig,
  fileVault: FileVaultService,
  vaultAdapters: VaultAdapters = safeDefaultVaultAdapters()
) {
  const authenticate = createAuthenticator(config);

  /**
   * Single source of truth for which vault capabilities are genuinely
   * wired up right now — replaces hand-written "not connected" strings in
   * `FileVaultPage.tsx` with one server-reported status object.
   */
  app.get("/v1/vault/integration-status", async (request, reply) => {
    try {
      await authenticate(request);
      return reply.code(200).send(currentVaultIntegrationStatus(vaultAdapters));
    } catch (error) {
      request.log.warn({ err: error }, "vault integration-status request rejected");
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.post("/v1/vault/items", async (request, reply) => {
    try {
      const principal = await authenticate(request);

      const body = z.object({
        itemType: z.enum(["DOCUMENT", "IDENTITY", "PHOTO", "RECOVERY", "OTHER"]),
        nameCiphertextBase64: base64Bytes(),
        metadataCiphertextBase64: base64Bytes(),
        keyEnvelopeBase64: base64Bytes(),
        contentHashBase64: base64Bytes(),
        encryptedSize: z.number().int().positive(),
        contentType: z.string().min(1).max(200)
      }).parse(request.body);

      const result = await fileVault.beginUpload({
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
      const items = await fileVault.list(principal.userId);
      return reply.code(200).send({ items });
    } catch (error) {
      request.log.warn({ err: error }, "vault item listing rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.get("/v1/vault/items/:itemId/download", async (request, reply) => {
    try {
      const principal = await authenticate(request);

      const params = z.object({
        itemId: z.string().uuid()
      }).parse(request.params);

      const download = await fileVault.download(principal.userId, params.itemId);
      return reply.code(200).send(download);
    } catch (error) {
      request.log.warn({ err: error }, "vault item download rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}
