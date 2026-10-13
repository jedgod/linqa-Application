import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { DeviceRepository } from "../repositories/device.repository.js";
import { KeyPackageRepository } from "../repositories/key-package.repository.js";
import { sha256 } from "../security/hash.js";
import { parseAndVerifyKeyPackage } from "../auth/key-package-proof.js";
import { TransparencyProofService } from "../services/transparency-proof.service.js";

const PublishSchema = z.object({
  packageVersion: z.number().int().min(1).max(10),
  packageBase64: z.string().min(64).max(1_000_000),
  expiresAt: z.string().datetime()
});

export async function registerKeyPackageRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database
) {
  const authenticate = createAuthenticator(config);
  const devices = new DeviceRepository(db);
  const packages = new KeyPackageRepository(db);
  const transparency = config.TRANSPARENCY_PRIVATE_KEY_PEM
    ? new TransparencyProofService(db, config.TRANSPARENCY_PRIVATE_KEY_PEM)
    : null;

  // Historical verification is scoped to an already accepted, visible ciphertext.
  // This never publishes revoked devices as encryption recipients or call peers.
  app.post('/v1/chats/:conversationId/messages/:messageId/sender-key', async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, 'messages:read');
      const params = z.object({conversationId:z.string().uuid(),messageId:z.string().uuid()}).parse(request.params);
      const body = z.object({senderUserId:z.string().uuid(),senderDeviceId:z.string().uuid(),ciphertextBase64:z.string().min(1).max(349528).regex(/^[A-Za-z0-9+/_=-]+$/)}).strict().parse(request.body);
      if (!principal.deviceId || !await devices.findActive(principal.deviceId, principal.userId)) return reply.code(403).send({error:'forbidden'});
      const ciphertext = Buffer.from(body.ciphertextBase64, 'base64');
      const result = await db.query(`WITH visible AS (
          SELECT id,conversation_id,sender_user_id,sender_device_id,body_ciphertext,created_at,expires_at,deleted_at FROM chat_messages m
          WHERE NOT EXISTS (SELECT 1 FROM chat_message_deletions md WHERE md.message_id=m.id AND md.user_id=$1)
          UNION ALL SELECT id,conversation_id,sender_user_id,sender_device_id,envelope,created_at,expires_at,deleted_at FROM thread_attachments a
          WHERE NOT EXISTS (SELECT 1 FROM chat_attachment_deletions ad WHERE ad.attachment_id=a.id AND ad.user_id=$1)
        ) SELECT d.signing_public_key
        FROM visible m
        JOIN devices d ON d.id=m.sender_device_id AND d.user_id=m.sender_user_id
        JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$1 AND cm.removed_at IS NULL
        WHERE m.conversation_id=$2 AND m.id=$3 AND m.sender_user_id=$4 AND m.sender_device_id=$5
          AND m.body_ciphertext=$6 AND m.deleted_at IS NULL
          AND (m.expires_at IS NULL OR m.expires_at>now())
          AND m.created_at>COALESCE(cm.cleared_at,'-infinity'::timestamptz)
          AND (d.revoked_at IS NULL OR m.created_at<=d.revoked_at)`,
        [principal.userId,params.conversationId,params.messageId,body.senderUserId,body.senderDeviceId,ciphertext]);
      const key = result.rows[0]?.signing_public_key as Buffer | undefined;
      if (!key || key.length!==32) return reply.code(404).send({error:'message_sender_key_not_found'});
      reply.header('Cache-Control','private, no-store');
      return {senderUserId:body.senderUserId,senderDeviceId:body.senderDeviceId,signingPublicKey:Array.from(key)};
    } catch { return reply.code(400).send({error:'invalid_request'}); }
  });

  app.put("/v1/devices/:deviceId/key-package", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "keys:write");

      const params = z.object({ deviceId: z.string().uuid() }).parse(request.params);
      const body = PublishSchema.parse(request.body);

      if (principal.deviceId !== params.deviceId) {
        return reply.code(403).send({ error: "device_mismatch" });
      }

      const device = await devices.findActive(params.deviceId, principal.userId);
      if (!device) {
        return reply.code(404).send({ error: "active_device_not_found" });
      }

      const packageBytes = Buffer.from(body.packageBase64, "base64");
      if (packageBytes.length < 48) {
        return reply.code(400).send({ error: "invalid_key_package" });
      }

      const expiresAt = new Date(body.expiresAt);
      if (expiresAt.getTime() <= Date.now()) {
        return reply.code(400).send({ error: "key_package_expired" });
      }

      const verified = parseAndVerifyKeyPackage({
        packageBytes,
        expectedUserId: principal.userId,
        expectedDeviceId: params.deviceId,
        enrolledSigningPublicKey: device.signing_public_key as Buffer
      });
      if (body.packageVersion !== verified.version ||
          Math.abs(expiresAt.getTime() - verified.expires_at_unix * 1000) >= 1000) {
        return reply.code(400).send({ error: "key_package_metadata_mismatch" });
      }

      const packageHash = sha256(packageBytes);

      const published = await packages.publish({
        userId: principal.userId,
        deviceId: params.deviceId,
        packageVersion: body.packageVersion,
        packageBytes,
        packageHash,
        expiresAt
      });

      return reply.code(201).send({
        id: published.id,
        packageHash: packageHash.toString("hex"),
        transparencySequence: published.transparencySequence
      });
    } catch (error) {
      request.log.warn({ err: error }, "key package publication rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.get("/v1/users/:userId/key-packages", async (request, reply) => {
    try {
      await authenticate(request);
      const params = z.object({ userId: z.string().uuid() }).parse(request.params);
      const rows = await packages.findActiveForUser(params.userId);
      reply.header('Cache-Control','private, no-store');

      if (config.NODE_ENV === "production" && !transparency) {
        return reply.code(503).send({ error: "transparency_checkpoint_signer_unavailable" });
      }

      return {
        keyPackages: await Promise.all(rows.map(async (row) => ({
          id: row.id,
          deviceId: row.device_id,
          packageVersion: row.package_version,
          packageBase64: (row.package_bytes as Buffer).toString("base64"),
          packageHash: (row.package_hash as Buffer).toString("hex"),
          expiresAt: row.expires_at,
          createdAt: row.created_at,
          ...(transparency ? { transparencyProof: await transparency.proofForPackage(row.package_hash as Buffer) } : {})
        })))
      };
    } catch {
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}
