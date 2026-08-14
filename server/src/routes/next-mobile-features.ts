import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";

export async function registerNextMobileFeatureRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
) {
  const authenticate = createAuthenticator(config);

  app.get("/v1/message-requests", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "message-requests:read");

      const result = await db.query(
        `SELECT r.id,
                r.sender_user_id,
                p.display_name,
                r.preview_ciphertext,
                r.mutual_contacts,
                r.risk_level,
                r.created_at
         FROM message_requests r
         LEFT JOIN user_profiles p ON p.user_id=r.sender_user_id
         WHERE r.recipient_user_id=$1
           AND r.status='PENDING'
         ORDER BY r.created_at DESC`,
        [principal.userId],
      );

      return {
        requests: result.rows.map((row) => ({
          id: row.id,
          senderUserId: row.sender_user_id,
          senderDisplayName: row.display_name ?? "Unknown sender",
          previewCiphertextBase64: (
            row.preview_ciphertext as Buffer
          ).toString("base64"),
          preview: "Encrypted message request",
          mutualContacts: row.mutual_contacts,
          riskLevel: row.risk_level,
          createdAt: row.created_at,
        })),
      };
    } catch (error) {
      request.log.warn({ err: error }, "message request list rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post(
    "/v1/message-requests/:requestId/resolve",
    async (request, reply) => {
      try {
        const principal = await authenticate(request);
        requireScope(principal, "message-requests:write");

        const params = z.object({
          requestId: z.string().uuid(),
        }).parse(request.params);

        const body = z.object({
          action: z.enum(["ACCEPT","DECLINE","BLOCK","REPORT"]),
        }).parse(request.body);

        const status = {
          ACCEPT: "ACCEPTED",
          DECLINE: "DECLINED",
          BLOCK: "BLOCKED",
          REPORT: "REPORTED",
        }[body.action];

        const client = await db.connect();

        try {
          await client.query("BEGIN");

          const resolved = await client.query(
            `UPDATE message_requests
             SET status=$3,resolved_at=now()
             WHERE id=$1
               AND recipient_user_id=$2
               AND status='PENDING'
             RETURNING sender_user_id`,
            [params.requestId, principal.userId, status],
          );

          if (resolved.rowCount !== 1) {
            await client.query("ROLLBACK");
            return reply.code(404).send({ error: "request_not_found" });
          }

          const senderUserId = resolved.rows[0].sender_user_id;

          if (body.action === "BLOCK" || body.action === "REPORT") {
            await client.query(
              `INSERT INTO blocked_users (
                 blocker_user_id,blocked_user_id,reason
               ) VALUES ($1,$2,$3)
               ON CONFLICT (blocker_user_id,blocked_user_id)
               DO UPDATE SET reason=EXCLUDED.reason`,
              [
                principal.userId,
                senderUserId,
                body.action === "REPORT"
                  ? "Blocked from reported request"
                  : "Blocked from message request",
              ],
            );
          }

          await client.query("COMMIT");
          return reply.code(204).send();
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        request.log.warn({ err: error }, "message request resolution rejected");
        return reply.code(400).send({ error: "invalid_request" });
      }
    },
  );

  app.post("/v1/status/:statusId/reactions", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "status:react");

      const params = z.object({
        statusId: z.string().uuid(),
      }).parse(request.params);

      const body = z.object({
        reaction: z.string().min(1).max(16),
      }).parse(request.body);

      await db.query(
        `INSERT INTO status_reactions (
           status_id,reactor_user_id,reaction
         ) VALUES ($1,$2,$3)
         ON CONFLICT (status_id,reactor_user_id)
         DO UPDATE SET reaction=EXCLUDED.reaction,created_at=now()`,
        [params.statusId, principal.userId, body.reaction],
      );

      return reply.code(204).send();
    } catch (error) {
      request.log.warn({ err: error }, "status reaction rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/status/:statusId/replies", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "status:reply");

      const params = z.object({
        statusId: z.string().uuid(),
      }).parse(request.params);

      const body = z.object({
        replyCiphertextBase64: z.string().min(24),
      }).parse(request.body);

      const ciphertext = Buffer.from(body.replyCiphertextBase64, "base64");
      if (ciphertext.length < 16) {
        return reply.code(400).send({ error: "invalid_reply_ciphertext" });
      }

      await db.query(
        `INSERT INTO status_replies (
           status_id,sender_user_id,reply_ciphertext
         ) VALUES ($1,$2,$3)`,
        [params.statusId, principal.userId, ciphertext],
      );

      return reply.code(201).send({ accepted: true });
    } catch (error) {
      request.log.warn({ err: error }, "status reply rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.get("/v1/security/device-alerts", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "devices:alerts:read");

      const result = await db.query(
        `SELECT a.*,d.device_name,d.platform
         FROM device_security_alerts a
         LEFT JOIN devices d ON d.id=a.device_id
         WHERE a.user_id=$1
           AND a.acknowledged_at IS NULL
         ORDER BY a.created_at DESC`,
        [principal.userId],
      );

      return { alerts: result.rows };
    } catch (error) {
      request.log.warn({ err: error }, "device alert list rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post(
    "/v1/security/device-alerts/:alertId/acknowledge",
    async (request, reply) => {
      try {
        const principal = await authenticate(request);
        requireScope(principal, "devices:alerts:write");

        const params = z.object({
          alertId: z.string().uuid(),
        }).parse(request.params);

        await db.query(
          `UPDATE device_security_alerts
           SET acknowledged_at=now()
           WHERE id=$1 AND user_id=$2`,
          [params.alertId, principal.userId],
        );

        return reply.code(204).send();
      } catch (error) {
        request.log.warn({ err: error }, "device alert acknowledgement rejected");
        return reply.code(400).send({ error: "invalid_request" });
      }
    },
  );

  app.get("/v1/storage/summary", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "storage:read");

      const result = await db.query(
        `SELECT encrypted_media_bytes,cache_bytes,database_bytes,captured_at
         FROM storage_usage_snapshots
         WHERE user_id=$1
         ORDER BY captured_at DESC
         LIMIT 1`,
        [principal.userId],
      );

      return result.rows[0] ?? {
        encrypted_media_bytes: 0,
        cache_bytes: 0,
        database_bytes: 0,
        captured_at: null,
      };
    } catch (error) {
      request.log.warn({ err: error }, "storage summary request rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}
