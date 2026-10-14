import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";

export async function registerMobileFeatureRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database
) {
  const authenticate = createAuthenticator(config);

  app.post("/v1/status", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "status:write");
      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const body = z.object({
        contentType: z.enum(["TEXT","IMAGE","VIDEO","VOICE"]).default("TEXT"),
        contentCiphertextBase64: z.string().min(24),
        privacy: z.enum(["CONTACTS","CLOSE_FRIENDS","CUSTOM"]),
        customAudienceUserIds: z.array(z.string().uuid()).default([]),
        expiresAt: z.string().datetime()
      }).parse(request.body);

      const expiresAt = new Date(body.expiresAt);
      if (expiresAt.getTime() <= Date.now()) {
        return reply.code(400).send({ error: "status_already_expired" });
      }

      const ciphertext = Buffer.from(body.contentCiphertextBase64, "base64");
      if (ciphertext.length < 16) {
        return reply.code(400).send({ error: "invalid_status_ciphertext" });
      }

      const result = await db.query(
        `INSERT INTO user_status_posts (
           user_id,device_id,content_type,content_ciphertext,
           privacy,custom_audience_user_ids,expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id,expires_at,created_at`,
        [
          principal.userId,
          principal.deviceId,
          body.contentType,
          ciphertext,
          body.privacy,
          body.customAudienceUserIds,
          expiresAt
        ]
      );

      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      request.log.warn({ err: error }, "status publish rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/calls/scheduled", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "calls:schedule");

      const body = z.object({
        participantUserIds: z.array(z.string().uuid()).min(1).max(100),
        callType: z.enum(["AUDIO","VIDEO"]),
        privacyMode: z.enum(["STANDARD","RELAY_ONLY"]),
        scheduledFor: z.string().datetime(),
        titleCiphertextBase64: z.string().optional()
      }).parse(request.body);

      const scheduledFor = new Date(body.scheduledFor);
      if (scheduledFor.getTime() <= Date.now()) {
        return reply.code(400).send({ error: "scheduled_time_in_past" });
      }

      // Only people the organizer is connected to (a saved contact or a shared chat) can be invited, and never a blocked one.
      const invitees = [...new Set(body.participantUserIds)].filter((id) => id !== principal.userId);
      const allowed = invitees.length
        ? await db.query(
            `SELECT p.id FROM unnest($2::uuid[]) AS p(id)
              WHERE NOT EXISTS (SELECT 1 FROM blocked_users b
                      WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = p.id) OR (b.blocker_user_id = p.id AND b.blocked_user_id = $1))
                AND (EXISTS (SELECT 1 FROM chat_contacts cc WHERE cc.owner_user_id = $1 AND cc.contact_user_id = p.id)
                  OR EXISTS (SELECT 1 FROM conversation_members mine JOIN conversation_members peer ON peer.conversation_id = mine.conversation_id
                       WHERE mine.user_id = $1 AND mine.removed_at IS NULL AND peer.user_id = p.id AND peer.removed_at IS NULL))`,
            [principal.userId, invitees])
        : { rows: [] as Array<{ id: string }> };
      if (!invitees.length || allowed.rows.length !== invitees.length) {
        return reply.code(403).send({ error: "participant_not_connected" });
      }

      const result = await db.query(
        `INSERT INTO scheduled_calls (
           organizer_user_id,participant_user_ids,call_type,
           privacy_mode,scheduled_for,title_ciphertext
         ) VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id,status,scheduled_for,created_at`,
        [
          principal.userId,
          body.participantUserIds,
          body.callType,
          body.privacyMode,
          scheduledFor,
          body.titleCiphertextBase64
            ? Buffer.from(body.titleCiphertextBase64, "base64")
            : null
        ]
      );

      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      request.log.warn({ err: error }, "scheduled call creation rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}
