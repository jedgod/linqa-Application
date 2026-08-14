import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator } from "../auth/jwt.js";
import { verifyEnrollmentProof } from "../auth/enrollment-proof.js";
import type { SessionService } from "../services/session.service.js";

const ENROLLED_DEVICE_SCOPES = [
  "ai:use",
  "attachments:write",
  "calendar:read",
  "calendar:write",
  "calls:read",
  "calls:schedule",
  "calls:write",
  "communities:read",
  "communities:write",
  "contacts:read",
  "contacts:write",
  "devices:alerts:read",
  "devices:alerts:write",
  "devices:read",
  "devices:write",
  "keys:write",
  "media:read",
  "message-requests:read",
  "message-requests:write",
  "messages:read",
  "messages:receive",
  "messages:send",
  "notifications:write",
  "notes:read",
  "notes:write",
  "premium:read",
  "privacy:read",
  "security:read",
  "settings:write",
  "status:react",
  "status:reply",
  "status:write",
  "storage:read",
  "sync:read",
  "sync:write",
  "wallet:read",
  "wallet:write",
  "emergency:read",
  "emergency:write"
];

const CompleteSchema = z.object({
  challengeId: z.string().uuid(),
  deviceName: z.string().trim().min(1).max(100),
  platform: z.enum(["WEB", "DESKTOP", "ANDROID", "IOS"]),
  signingPublicKeyBase64: z.string().min(40).max(100),
  encryptionPublicKeyBase64: z.string().min(40).max(100),
  signatureBase64: z.string().min(80).max(120)
});

export async function registerEnrollmentRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  sessions: SessionService
) {
  const authenticate = createAuthenticator(config);

  app.post("/v1/device-enrollment/challenges", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      const nonce = randomBytes(32);
      const expiresAt = new Date(Date.now() + config.DEVICE_CHALLENGE_TTL_SECONDS * 1000);

      const inserted = await db.query(
        `INSERT INTO device_registration_challenges (user_id, nonce, expires_at)
         VALUES ($1, $2, $3)
         RETURNING id, expires_at`,
        [principal.userId, nonce, expiresAt]
      );

      return reply.code(201).send({
        challengeId: inserted.rows[0].id,
        userId: principal.userId,
        nonceBase64: nonce.toString("base64"),
        expiresAt: inserted.rows[0].expires_at
      });
    } catch (error) {
      request.log.warn({ err: error }, "device enrollment challenge rejected");
      return reply.code(401).send({ error: "unauthenticated" });
    }
  });

  app.post("/v1/device-enrollment/complete", async (request, reply) => {
    let principal;
    try {
      principal = await authenticate(request);
    } catch (error) {
      request.log.warn({ err: error }, "device enrollment completion rejected");
      return reply.code(401).send({ error: "unauthenticated" });
    }

    try {
      const body = CompleteSchema.parse(request.body);
      const client = await db.connect();

      try {
        await client.query("BEGIN");

        const challenge = await client.query(
          `SELECT id, user_id, nonce, expires_at, consumed_at
           FROM device_registration_challenges
           WHERE id = $1 AND user_id = $2
           FOR UPDATE`,
          [body.challengeId, principal.userId]
        );
        const row = challenge.rows[0];

        if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now()) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "invalid_or_expired_challenge" });
        }

        const signingPublicKey = Buffer.from(body.signingPublicKeyBase64, "base64");
        const encryptionPublicKey = Buffer.from(body.encryptionPublicKeyBase64, "base64");
        const signature = Buffer.from(body.signatureBase64, "base64");

        const verified = verifyEnrollmentProof(
          {
            challengeId: row.id,
            userId: row.user_id,
            nonce: row.nonce,
            expiresAtUnix: BigInt(Math.floor(new Date(row.expires_at).getTime() / 1000))
          },
          {
            deviceName: body.deviceName,
            platform: body.platform,
            signingPublicKey,
            encryptionPublicKey,
            signature
          }
        );

        if (!verified) {
          await client.query("ROLLBACK");
          return reply.code(401).send({ error: "invalid_proof", message: "Device was not registered." });
        }

        const device = await client.query(
          `INSERT INTO devices (user_id, device_name, platform, signing_public_key, encryption_public_key, status, registered_at)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', now())
           ON CONFLICT (user_id, signing_public_key)
           DO UPDATE SET device_name = EXCLUDED.device_name, platform = EXCLUDED.platform,
             encryption_public_key = EXCLUDED.encryption_public_key, status = 'ACTIVE', registered_at = now()
           RETURNING id`,
          [principal.userId, body.deviceName, body.platform, signingPublicKey, encryptionPublicKey]
        );

        await client.query(
          `UPDATE device_registration_challenges SET consumed_at = now() WHERE id = $1`,
          [row.id]
        );

        await client.query("COMMIT");

        const deviceId = device.rows[0].id as string;
        const scopes = Array.from(
          new Set([...principal.scopes, ...ENROLLED_DEVICE_SCOPES])
        );
        const session = await sessions.create({
          userId: principal.userId,
          subject: principal.subject,
          deviceId,
          scopes
        });

        return reply.code(201).send({ deviceId, status: "ACTIVE", session });
      } finally {
        client.release();
      }
    } catch (error) {
      request.log.warn({ err: error }, "device enrollment completion rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}
