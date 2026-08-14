import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import type { RealtimeHub } from "../realtime/hub.js";

const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_DEVICE_ID = "10000000-0000-4000-8000-000000000001";

function requireDevelopmentClient(request: FastifyRequest): void {
  if (request.headers["x-linqa-demo-user"] !== "galaxy") {
    throw new Error("development client header required");
  }
}

async function ensureDevelopmentSeed(db: Database): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO users (id, external_subject, status) VALUES
        ('00000000-0000-4000-8000-000000000001','dev:galaxy','ACTIVE'),
        ('00000000-0000-4000-8000-000000000002','dev:avery','ACTIVE'),
        ('00000000-0000-4000-8000-000000000003','dev:lin','ACTIVE'),
        ('00000000-0000-4000-8000-000000000004','dev:priya','ACTIVE'),
        ('00000000-0000-4000-8000-000000000005','dev:marcus','ACTIVE'),
        ('00000000-0000-4000-8000-000000000006','dev:sana','ACTIVE')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO user_profiles (user_id, display_name, bio) VALUES
        ('00000000-0000-4000-8000-000000000001','You','Private communication preview'),
        ('00000000-0000-4000-8000-000000000002','Avery Chen','Product designer'),
        ('00000000-0000-4000-8000-000000000003','Lin Ochoa','Engineering'),
        ('00000000-0000-4000-8000-000000000004','Priya Nair','Security research'),
        ('00000000-0000-4000-8000-000000000005','Marcus Webb','Community lead'),
        ('00000000-0000-4000-8000-000000000006','Sana Rehman','Operations')
      ON CONFLICT (user_id) DO NOTHING;

      INSERT INTO devices (
        id,user_id,device_name,platform,signing_public_key,encryption_public_key,
        status,registered_at,last_seen_at
      ) VALUES
        ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Galaxy','ANDROID',decode(repeat('01',32),'hex'),decode(repeat('11',32),'hex'),'ACTIVE',now(),now()),
        ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','Avery phone','ANDROID',decode(repeat('02',32),'hex'),decode(repeat('12',32),'hex'),'ACTIVE',now(),now()),
        ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003','Lin desktop','DESKTOP',decode(repeat('03',32),'hex'),decode(repeat('13',32),'hex'),'ACTIVE',now(),now() - interval '2 hours'),
        ('10000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000004','Priya phone','ANDROID',decode(repeat('04',32),'hex'),decode(repeat('14',32),'hex'),'ACTIVE',now(),now()),
        ('10000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000005','Marcus web','WEB',decode(repeat('05',32),'hex'),decode(repeat('15',32),'hex'),'ACTIVE',now(),now() - interval '1 day'),
        ('10000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000006','Sana phone','ANDROID',decode(repeat('06',32),'hex'),decode(repeat('16',32),'hex'),'ACTIVE',now(),now())
      ON CONFLICT (id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;

      INSERT INTO conversations (
        id,conversation_type,created_by_user_id,display_title,last_message_preview,last_message_at
      ) VALUES
        ('20000000-0000-4000-8000-000000000001','DIRECT','00000000-0000-4000-8000-000000000001','Avery Chen','Can you sanity check the device flow?',now() - interval '4 minutes'),
        ('20000000-0000-4000-8000-000000000002','GROUP','00000000-0000-4000-8000-000000000001','Design Sync','You: Fixed, pushing a new export now.',now() - interval '1 hour'),
        ('20000000-0000-4000-8000-000000000003','DIRECT','00000000-0000-4000-8000-000000000001','Lin Ochoa','You: Sure, noon works.',now() - interval '1 day'),
        ('20000000-0000-4000-8000-000000000004','DIRECT','00000000-0000-4000-8000-000000000001','Priya Nair','New fingerprint ready to verify.',now() - interval '20 minutes'),
        ('20000000-0000-4000-8000-000000000005','DIRECT','00000000-0000-4000-8000-000000000001','Sana Rehman','Meeting moved to 3pm.',now() - interval '1 day')
      ON CONFLICT (id) DO UPDATE SET
        display_title = EXCLUDED.display_title,
        last_message_preview = EXCLUDED.last_message_preview,
        last_message_at = EXCLUDED.last_message_at;

      INSERT INTO conversation_members (
        conversation_id,user_id,role,pinned,muted,unread_count
      ) VALUES
        ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','OWNER',TRUE,FALSE,2),
        ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','MEMBER',FALSE,FALSE,0),
        ('20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','OWNER',FALSE,FALSE,0),
        ('20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','MEMBER',FALSE,FALSE,0),
        ('20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','MEMBER',FALSE,FALSE,0),
        ('20000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','OWNER',FALSE,FALSE,0),
        ('20000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003','MEMBER',FALSE,FALSE,0),
        ('20000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','OWNER',FALSE,FALSE,5),
        ('20000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000004','MEMBER',FALSE,FALSE,0),
        ('20000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','OWNER',FALSE,TRUE,0),
        ('20000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006','MEMBER',FALSE,FALSE,0)
      ON CONFLICT (conversation_id,user_id) DO UPDATE SET
        pinned = EXCLUDED.pinned,
        muted = EXCLUDED.muted,
        unread_count = EXCLUDED.unread_count;

      INSERT INTO user_status_updates (id,user_id,body,expires_at,created_at) VALUES
        ('60000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','Reviewing the new mobile hub',now() + interval '24 hours',now() - interval '2 minutes'),
        ('60000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000004','Security review in progress',now() + interval '24 hours',now() - interval '12 minutes')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO communities (id,owner_user_id,name,visibility,status) VALUES
        ('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Team Linqa','PRIVATE','ACTIVE')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO community_memberships (community_id,user_id,role,status) VALUES
        ('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','OWNER','ACTIVE')
      ON CONFLICT (community_id,user_id) DO NOTHING;

      INSERT INTO call_history (id,user_id,peer_user_id,direction,call_type,status,started_at,ended_at,duration_seconds,created_at) VALUES
        ('40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','OUTGOING','AUDIO','COMPLETED',now() - interval '2 days',now() - interval '2 days' + interval '12 minutes',720,now() - interval '2 days')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO media_index (id,user_id,conversation_id,media_type,object_key,starred,created_at) VALUES
        ('50000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','IMAGE','development/design-preview.enc',TRUE,now() - interval '3 hours'),
        ('50000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','DOCUMENT','development/device-flow.enc',FALSE,now() - interval '1 day')
      ON CONFLICT (id) DO NOTHING;
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function registerMobileHubRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  hub: RealtimeHub
) {
  if (config.NODE_ENV === "production") return;

  app.get("/v1/dev/mobile-hub", async (request, reply) => {
    try {
      requireDevelopmentClient(request);
      await ensureDevelopmentSeed(db);
      const [profile, contacts, conversations, statuses, calls, communities, media, devices] =
        await Promise.all([
          db.query(`SELECT user_id AS id, display_name, bio FROM user_profiles WHERE user_id = $1`, [DEMO_USER_ID]),
          db.query(`
            SELECT p.user_id AS id, p.display_name,
              EXISTS (
                SELECT 1 FROM devices d
                WHERE d.user_id = p.user_id AND d.status = 'ACTIVE'
                  AND d.last_seen_at > now() - interval '15 minutes'
              ) AS online,
              s.body AS status_body, s.created_at AS status_created_at
            FROM user_profiles p
            LEFT JOIN LATERAL (
              SELECT body, created_at FROM user_status_updates
              WHERE user_id = p.user_id AND expires_at > now()
              ORDER BY created_at DESC LIMIT 1
            ) s ON TRUE
            WHERE p.user_id <> $1
            ORDER BY p.display_name`, [DEMO_USER_ID]),
          db.query(`
            SELECT c.id, c.conversation_type, c.display_title, c.last_message_preview,
              c.last_message_at, cm.pinned, cm.muted, cm.unread_count,
              COALESCE(array_agg(other.user_id) FILTER (WHERE other.user_id <> $1), '{}') AS participant_ids
            FROM conversations c
            JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1 AND cm.removed_at IS NULL
            LEFT JOIN conversation_members other ON other.conversation_id = c.id AND other.removed_at IS NULL
            WHERE c.archived_at IS NULL
            GROUP BY c.id, cm.pinned, cm.muted, cm.unread_count
            ORDER BY cm.pinned DESC, c.last_message_at DESC NULLS LAST`, [DEMO_USER_ID]),
          db.query(`
            SELECT id, body, visibility, expires_at, created_at
            FROM user_status_updates
            WHERE user_id = $1 AND expires_at > now()
            ORDER BY created_at DESC LIMIT 10`, [DEMO_USER_ID]),
          db.query(`
            SELECT ch.id, ch.direction, ch.call_type, ch.status, ch.duration_seconds,
              ch.created_at, p.display_name AS peer_name
            FROM call_history ch
            LEFT JOIN user_profiles p ON p.user_id = ch.peer_user_id
            WHERE ch.user_id = $1 ORDER BY ch.created_at DESC LIMIT 25`, [DEMO_USER_ID]),
          db.query(`
            SELECT c.id, c.name, c.visibility, cm.role, c.created_at
            FROM communities c JOIN community_memberships cm ON cm.community_id = c.id
            WHERE cm.user_id = $1 AND cm.status = 'ACTIVE' AND c.status = 'ACTIVE'
            ORDER BY c.created_at DESC`, [DEMO_USER_ID]),
          db.query(`
            SELECT m.id, m.media_type, m.starred, m.created_at, c.display_title AS conversation_title
            FROM media_index m LEFT JOIN conversations c ON c.id = m.conversation_id
            WHERE m.user_id = $1 AND (m.expires_at IS NULL OR m.expires_at > now())
            ORDER BY m.created_at DESC LIMIT 50`, [DEMO_USER_ID])
          ,db.query(`
            SELECT id, device_name, platform, registered_at, last_seen_at,
              id = $2 AS is_current
            FROM devices WHERE user_id = $1 AND status = 'ACTIVE'
            ORDER BY is_current DESC, last_seen_at DESC NULLS LAST`, [DEMO_USER_ID, DEMO_DEVICE_ID])
        ]);

      return {
        generatedAt: new Date().toISOString(),
        profile: profile.rows[0],
        contacts: contacts.rows,
        conversations: conversations.rows,
        statuses: statuses.rows,
        calls: calls.rows,
        communities: communities.rows,
        media: media.rows,
        devices: devices.rows
      };
    } catch (error) {
      request.log.warn({ err: error }, "development mobile hub read rejected");
      return reply.code(400).send({ error: "mobile_hub_unavailable" });
    }
  });

  app.post("/v1/dev/mobile-hub/statuses", async (request, reply) => {
    try {
      requireDevelopmentClient(request);
      await ensureDevelopmentSeed(db);
      const body = z.object({ body: z.string().trim().min(1).max(280) }).parse(request.body);
      const inserted = await db.query(
        `INSERT INTO user_status_updates (user_id,body) VALUES ($1,$2)
         RETURNING id,body,visibility,expires_at,created_at`,
        [DEMO_USER_ID, body.body]
      );
      hub.sendToUser(DEMO_USER_ID, { type: "mobile-hub.changed", resource: "status" });
      return reply.code(201).send(inserted.rows[0]);
    } catch (error) {
      request.log.warn({ err: error }, "development status publish rejected");
      return reply.code(400).send({ error: "invalid_status" });
    }
  });

  app.post("/v1/dev/mobile-hub/conversations", async (request, reply) => {
    try {
      requireDevelopmentClient(request);
      await ensureDevelopmentSeed(db);
      const body = z.object({ recipientUserId: z.string().uuid() }).parse(request.body);
      const recipient = await db.query(
        `SELECT display_name FROM user_profiles WHERE user_id = $1 AND user_id <> $2`,
        [body.recipientUserId, DEMO_USER_ID]
      );
      if (recipient.rowCount !== 1) return reply.code(404).send({ error: "recipient_not_found" });

      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const created = await client.query(
          `INSERT INTO conversations (conversation_type,created_by_user_id,display_title,last_message_preview,last_message_at)
           VALUES ('DIRECT',$1,$2,'New conversation',now()) RETURNING id`,
          [DEMO_USER_ID, recipient.rows[0].display_name]
        );
        await client.query(
          `INSERT INTO conversation_members (conversation_id,user_id,role) VALUES
             ($1,$2,'OWNER'),($1,$3,'MEMBER')`,
          [created.rows[0].id, DEMO_USER_ID, body.recipientUserId]
        );
        await client.query("COMMIT");
        hub.sendToUser(DEMO_USER_ID, { type: "mobile-hub.changed", resource: "conversation" });
        return reply.code(201).send({ id: created.rows[0].id });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      request.log.warn({ err: error }, "development conversation creation rejected");
      return reply.code(400).send({ error: "invalid_conversation" });
    }
  });

  app.post("/v1/dev/mobile-hub/calls", async (request, reply) => {
    try {
      requireDevelopmentClient(request);
      await ensureDevelopmentSeed(db);
      const body = z.object({
        peerUserId: z.string().uuid(),
        callType: z.enum(["AUDIO", "VIDEO"]).default("AUDIO")
      }).parse(request.body);
      const inserted = await db.query(
        `INSERT INTO call_history (user_id,peer_user_id,direction,call_type,status,started_at,ended_at,duration_seconds)
         VALUES ($1,$2,'OUTGOING',$3,'CANCELLED',now(),now(),0)
         RETURNING id,created_at`,
        [DEMO_USER_ID, body.peerUserId, body.callType]
      );
      hub.sendToUser(DEMO_USER_ID, { type: "mobile-hub.changed", resource: "call" });
      return reply.code(201).send(inserted.rows[0]);
    } catch (error) {
      request.log.warn({ err: error }, "development call creation rejected");
      return reply.code(400).send({ error: "invalid_call" });
    }
  });

  app.get("/v1/dev/mobile-hub/live", { websocket: true }, (socket, request) => {
    try {
      requireDevelopmentClient(request);
      const remove = hub.add({ socket, userId: DEMO_USER_ID, deviceId: DEMO_DEVICE_ID });
      socket.send(JSON.stringify({ type: "ready" }));
      socket.on("close", remove);
      socket.on("error", remove);
      socket.on("message", (raw) => {
        if (raw.toString() === "ping") socket.send("pong");
      });
    } catch {
      socket.close(4001, "development client header required");
    }
  });
}