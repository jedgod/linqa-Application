// Publishing: the server half of the supplied linqa-publishing pack (posts and events with optional media).
//
// The routes, request shapes, validation, idempotency rules and limits are the pack's (server/src/index.js, validation.js),
// moved onto this server's own sign-in, database pool and storage:
//  - Authentication is this server's token check (and an active device), not a separate JWKS service.
//  - Media bytes are not sent to S3 through a presigned URL. The upload response has the same shape ({ uploadId, url, method,
//    headers }) but the URL is a short-lived signed address on this server (the same pattern the Vault uses in development).
//    Without configured object storage in production, media upload is refused rather than writing to local disk; text-only
//    posts still work.
//  - Publishing refuses media whose bytes did not arrive, differ in length from what was declared, or do not look like the
//    declared type.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";

// ---- validation (pack: validation.js) -------------------------------------------------------------------------------
const uuid = z.string().uuid();
const eventBase = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).default(""),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    timezone: z.string().min(1).max(80),
    location: z.string().max(500).default(""),
    coordinates: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).nullable().optional(),
    visibility: z.enum(["public", "country", "community", "private"]).default("public"),
    feelingActivity: z.string().max(120).nullable().optional(),
    uploadIds: z.array(uuid).max(10).default([]),
    taggedUserIds: z.array(uuid).max(20).default([])
  })
  .strict();
export const eventInput = eventBase.refine((x) => !x.endsAt || Date.parse(x.endsAt) > Date.parse(x.startsAt), { message: "endsAt must follow startsAt" });

export const uploadInput = z
  .object({
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime"]),
    bytes: z.number().int().positive().max(100 * 1024 * 1024)
  })
  .strict();

const MB = 1024 * 1024;
const UPLOAD_TTL_MS = 15 * 60_000;
export const PUBLISHING_DIR = path.resolve(process.cwd(), ".local-publishing");

// ---- signed upload addresses ------------------------------------------------------------------------------------------
type Claim = { u: string; exp: number };
const sign = (secret: string, claim: Claim) => {
  const body = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(`publishing-upload:${body}`).digest("base64url")}`;
};
function verify(secret: string, token: string): Claim | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(`publishing-upload:${body}`).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claim = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claim;
    return claim.exp > Date.now() && uuid.safeParse(claim.u).success ? claim : null;
  } catch {
    return null;
  }
}

/** Does the start of the file look like what the client said it was? The declared type alone is not trusted. */
export function looksLike(mime: string, head: Buffer): boolean {
  if (mime === "image/jpeg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === "image/png") return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/gif") return head.subarray(0, 4).toString("ascii") === "GIF8";
  if (mime === "image/webp") return head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP";
  if (mime === "video/mp4" || mime === "video/quicktime") return head.subarray(4, 8).toString("ascii") === "ftyp";
  return false;
}

const fileFor = (ownerId: string, uploadId: string) => path.join(PUBLISHING_DIR, ownerId, uploadId);

export async function registerPublishingRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  const authenticate = createAuthenticator(config);
  const secret = config.JWT_HS256_SECRET;
  // Media goes to local disk only outside production; production needs real object storage, which publishing does not have yet.
  const mediaEnabled = config.NODE_ENV !== "production" && Boolean(secret);

  async function who(request: FastifyRequest, reply: FastifyReply, scope: "countrylinqa:read" | "countrylinqa:write") {
    try {
      const principal = await authenticate(request);
      requireScope(principal, scope);
      if (principal.deviceId) {
        const device = await db.query("SELECT 1 FROM devices WHERE id=$1 AND user_id=$2 AND status='ACTIVE' AND revoked_at IS NULL", [principal.deviceId, principal.userId]);
        if (!device.rowCount) throw new Error("revoked device");
      }
      return principal.userId;
    } catch {
      void reply.code(401).send({ error: "invalid_token" });
      return null;
    }
  }
  const fail = (reply: FastifyReply, status: number, code: string) => reply.code(status).send({ error: code });

  // Uploaded bytes arrive as raw bodies (the address itself is the credential), so no multipart parser is needed.
  await app.register(async (scope) => {
    // The avatar upload registers the image types on the root with a 5 MB limit; inside this scope they are replaced.
    const types = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime"];
    for (const type of types) if (scope.hasContentTypeParser(type)) scope.removeContentTypeParser(type);
    scope.addContentTypeParser(types, { parseAs: "buffer", bodyLimit: 100 * MB }, (_request, body, done) => done(null, body));

    scope.put("/api/publishing/blobs/*", async (request, reply) => {
      if (!mediaEnabled) return fail(reply, 503, "media_storage_unavailable");
      const claim = verify(secret, (request.params as { "*": string })["*"]);
      const body = request.body;
      if (!claim || !Buffer.isBuffer(body)) return fail(reply, 403, "invalid_upload");
      const row = await db.query("SELECT owner_id, mime_type, bytes FROM publishing_uploads WHERE id=$1 AND consumed_event_id IS NULL AND expires_at>now()", [claim.u]);
      const upload = row.rows[0] as { owner_id: string; mime_type: string; bytes: string } | undefined;
      if (!upload) return fail(reply, 403, "invalid_upload");
      if (body.length !== Number(upload.bytes) || request.headers["content-type"] !== upload.mime_type || !looksLike(upload.mime_type, body.subarray(0, 16))) {
        return fail(reply, 400, "upload_mismatch");
      }
      const file = fileFor(upload.owner_id, claim.u);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      await db.query("UPDATE publishing_uploads SET received_bytes=$2 WHERE id=$1", [claim.u, body.length]);
      return reply.code(200).send();
    });
  });

  // Requests for an upload address. Same body and answer as the pack.
  app.post("/api/publishing/uploads", async (request, reply) => {
    const userId = await who(request, reply, "countrylinqa:write");
    if (!userId) return reply;
    if (!mediaEnabled) return fail(reply, 503, "media_storage_unavailable");
    const parsed = uploadInput.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "invalid_upload");
    const { mimeType, bytes } = parsed.data;
    const kind = mimeType.startsWith("image/") ? "image" : "video";
    if (bytes > (kind === "image" ? 10 : 100) * MB) return fail(reply, 400, "file_too_large");
    const id = randomUUID();
    const key = `publishing/${userId}/${id}`;
    const expires = new Date(Date.now() + UPLOAD_TTL_MS);
    await db.query("INSERT INTO publishing_uploads(id,owner_id,object_key,mime_type,bytes,kind,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, userId, key, mimeType, bytes, kind, expires]);
    // A path, not a full address: the phone resolves it against the API address it already uses.
    const url = `/api/publishing/blobs/${sign(secret, { u: id, exp: expires.getTime() })}`;
    return reply.code(201).send({ uploadId: id, url, method: "PUT", headers: { "Content-Type": mimeType }, expiresAt: expires.toISOString() });
  });

  // Publish. Idempotent on the Idempotency-Key header: a repeat returns the same event.
  app.post("/api/publishing/events", async (request, reply) => {
    const userId = await who(request, reply, "countrylinqa:write");
    if (!userId) return reply;
    const parsed = eventInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_event", details: parsed.error.flatten() });
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !uuid.safeParse(key).success) return fail(reply, 400, "invalid_idempotency_key");
    const e = parsed.data;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      // Serialize requests that share a key, including simultaneous submissions.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${userId}:${key}`]);
      const existing = await client.query("SELECT event_id FROM publishing_idempotency WHERE owner_id=$1 AND idempotency_key=$2", [userId, key]);
      if (existing.rowCount) {
        await client.query("COMMIT");
        return reply.code(200).send({ id: existing.rows[0].event_id, status: "published", replayed: true });
      }
      const uploadIds = [...new Set(e.uploadIds)];
      if (uploadIds.length !== e.uploadIds.length) { await client.query("ROLLBACK"); return fail(reply, 400, "duplicate_upload_ids"); }
      let uploads: Array<{ id: string; object_key: string; mime_type: string; bytes: string; kind: string; received_bytes: string | null }> = [];
      if (uploadIds.length) {
        const r = await client.query("SELECT * FROM publishing_uploads WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND consumed_event_id IS NULL AND expires_at>now() FOR UPDATE", [uploadIds, userId]);
        if (r.rowCount !== uploadIds.length) { await client.query("ROLLBACK"); return fail(reply, 400, "invalid_upload_ids"); }
        uploads = r.rows;
        for (const u of uploads) {
          const size = await stat(fileFor(userId, u.id)).then((s) => s.size).catch(() => -1);
          if (size !== Number(u.bytes) || Number(u.received_bytes) !== Number(u.bytes)) { await client.query("ROLLBACK"); return fail(reply, 409, "upload_not_verified"); }
        }
      }
      // Only people the publisher is connected to (a saved contact or a shared chat) and not blocked can be tagged.
      const tagged = [...new Set(e.taggedUserIds)].filter((id) => id !== userId);
      if (tagged.length) {
        const ok = await client.query(
          `SELECT p.id FROM unnest($2::uuid[]) AS p(id)
            WHERE NOT EXISTS (SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=p.id) OR (b.blocker_user_id=p.id AND b.blocked_user_id=$1))
              AND (EXISTS (SELECT 1 FROM chat_contacts cc WHERE cc.owner_user_id=$1 AND cc.contact_user_id=p.id)
                OR EXISTS (SELECT 1 FROM conversation_members mine JOIN conversation_members peer ON peer.conversation_id=mine.conversation_id
                     WHERE mine.user_id=$1 AND mine.removed_at IS NULL AND peer.user_id=p.id AND peer.removed_at IS NULL))`,
          [userId, tagged]
        );
        if (ok.rowCount !== tagged.length) { await client.query("ROLLBACK"); return fail(reply, 403, "tag_not_connected"); }
      }
      const r = await client.query(
        `INSERT INTO publishing_events(creator_id,title,description,starts_at,ends_at,timezone,venue_name,latitude,longitude,visibility,status,feeling_activity)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'published',$11) RETURNING id,status`,
        [userId, e.title, e.description, e.startsAt, e.endsAt || null, e.timezone, e.location, e.coordinates?.latitude ?? null, e.coordinates?.longitude ?? null, e.visibility, e.feelingActivity || null]
      );
      const event = r.rows[0] as { id: string; status: string };
      for (const u of uploads) {
        await client.query("INSERT INTO publishing_media(event_id,object_key,mime_type,bytes,kind) VALUES($1,$2,$3,$4,$5)", [event.id, u.object_key, u.mime_type, u.bytes, u.kind]);
        await client.query("UPDATE publishing_uploads SET consumed_event_id=$1 WHERE id=$2", [event.id, u.id]);
      }
      for (const id of tagged) await client.query("INSERT INTO publishing_event_tags(event_id,user_id) VALUES($1,$2)", [event.id, id]);
      await client.query("INSERT INTO publishing_idempotency(owner_id,idempotency_key,event_id) VALUES($1,$2,$3)", [userId, key, event.id]);
      await client.query("COMMIT");
      return reply.code(201).send(event);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ err: error }, "publishing create failed");
      return fail(reply, 500, "internal_error");
    } finally {
      client.release();
    }
  });

  app.get("/api/publishing/events/:id", async (request, reply) => {
    const userId = await who(request, reply, "countrylinqa:read");
    if (!userId) return reply;
    const { id } = request.params as { id: string };
    if (!uuid.safeParse(id).success) return fail(reply, 400, "invalid_id");
    const r = await db.query(
      `SELECT e.id,e.creator_id,e.title,e.description,e.starts_at,e.ends_at,e.timezone,e.venue_name,e.latitude,e.longitude,e.visibility,e.status,e.feeling_activity,e.created_at,
              COALESCE((SELECT json_agg(json_build_object('id',m.id,'kind',m.kind,'mimeType',m.mime_type) ORDER BY m.created_at) FROM publishing_media m WHERE m.event_id=e.id),'[]'::json) AS media,
              COALESCE((SELECT json_agg(json_build_object('userId',t.user_id,'name',COALESCE(tp.display_name,'Linqa user')) ORDER BY tp.display_name) FROM publishing_event_tags t LEFT JOIN user_profiles tp ON tp.user_id=t.user_id WHERE t.event_id=e.id),'[]'::json) AS tagged
         FROM publishing_events e WHERE e.id=$1 AND (e.creator_id=$2 OR (e.visibility='public' AND e.status='published'))`,
      [id, userId]
    );
    if (!r.rowCount) return fail(reply, 404, "not_found");
    void reply.header("Cache-Control", "private, no-store");
    return reply.send(r.rows[0]);
  });

  app.get("/api/publishing/events", async (request, reply) => {
    const userId = await who(request, reply, "countrylinqa:read");
    if (!userId) return reply;
    const limit = Math.min(Math.max(Number((request.query as { limit?: string }).limit) || 20, 1), 50);
    const r = await db.query(
      `SELECT e.id,e.title,e.description,e.starts_at,e.venue_name,e.visibility,e.status,e.creator_id,p.display_name AS creator_name,
              e.created_at,e.latitude,e.longitude,e.feeling_activity,
              (SELECT count(*)::int FROM publishing_media m WHERE m.event_id=e.id) AS media_count,
              COALESCE((SELECT json_agg(json_build_object('id',m.id,'kind',m.kind,'mimeType',m.mime_type) ORDER BY m.created_at) FROM publishing_media m WHERE m.event_id=e.id),'[]'::json) AS media,
              COALESCE((SELECT json_agg(json_build_object('userId',t.user_id,'name',COALESCE(tp.display_name,'Linqa user')) ORDER BY tp.display_name) FROM publishing_event_tags t LEFT JOIN user_profiles tp ON tp.user_id=t.user_id WHERE t.event_id=e.id),'[]'::json) AS tagged
         FROM publishing_events e LEFT JOIN user_profiles p ON p.user_id=e.creator_id
        WHERE (e.creator_id=$1 AND e.status<>'cancelled') OR (e.visibility='public' AND e.status='published')
        ORDER BY e.created_at DESC,e.id DESC LIMIT $2`,
      [userId, limit]
    );
    void reply.header("Cache-Control", "private, no-store");
    return reply.send({ events: r.rows });
  });

  // A piece of published media, with the same visibility rule as the event it belongs to.
  app.get("/api/publishing/media/:id", async (request, reply) => {
    const userId = await who(request, reply, "countrylinqa:read");
    if (!userId) return reply;
    const { id } = request.params as { id: string };
    if (!uuid.safeParse(id).success) return fail(reply, 400, "invalid_id");
    const r = await db.query(
      `SELECT m.mime_type, m.object_key, e.creator_id FROM publishing_media m JOIN publishing_events e ON e.id=m.event_id
        WHERE m.id=$1 AND (e.creator_id=$2 OR (e.visibility='public' AND e.status='published'))`,
      [id, userId]
    );
    const row = r.rows[0] as { mime_type: string; object_key: string; creator_id: string } | undefined;
    if (!row) return fail(reply, 404, "not_found");
    const uploadId = row.object_key.split("/").pop() ?? "";
    if (!uuid.safeParse(uploadId).success) return fail(reply, 404, "not_found");
    try {
      const data = await readFile(fileFor(row.creator_id, uploadId));
      void reply.header("Cache-Control", "private, max-age=3600").header("X-Content-Type-Options", "nosniff");
      return reply.type(row.mime_type).send(data);
    } catch {
      return fail(reply, 404, "not_found");
    }
  });

  app.patch("/api/publishing/events/:id", async (request, reply) => {
    const userId = await who(request, reply, "countrylinqa:write");
    if (!userId) return reply;
    const { id } = request.params as { id: string };
    if (!uuid.safeParse(id).success) return fail(reply, 400, "invalid_id");
    const parsed = eventBase.omit({ uploadIds: true }).partial().safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "invalid_event");
    const p = parsed.data as Record<string, unknown> & { coordinates?: { latitude: number; longitude: number } | null };
    if (!Object.keys(p).length) return fail(reply, 400, "empty_update");
    const names: Record<string, string> = { title: "title", description: "description", startsAt: "starts_at", endsAt: "ends_at", timezone: "timezone", location: "venue_name", visibility: "visibility", feelingActivity: "feeling_activity" };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(names)) if (Object.hasOwn(p, key)) { values.push(p[key]); sets.push(`${column}=$${values.length}`); }
    if (Object.hasOwn(p, "coordinates")) {
      values.push(p.coordinates?.latitude ?? null); sets.push(`latitude=$${values.length}`);
      values.push(p.coordinates?.longitude ?? null); sets.push(`longitude=$${values.length}`);
    }
    values.push(id, userId);
    const r = await db.query(`UPDATE publishing_events SET ${sets.join(",")},updated_at=now() WHERE id=$${values.length - 1} AND creator_id=$${values.length} AND status='published' RETURNING id,status`, values);
    if (!r.rowCount) return fail(reply, 404, "not_found");
    return reply.send(r.rows[0]);
  });

  // Cancel has no body. Clients that still send a JSON content type with nothing in it (as Express allowed) are accepted.
  await app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
      try { done(null, body ? JSON.parse(body as string) : {}); } catch (error) { done(error as Error, undefined); }
    });
    scope.post("/api/publishing/events/:id/cancel", async (request, reply) => {
      const userId = await who(request, reply, "countrylinqa:write");
      if (!userId) return reply;
      const { id } = request.params as { id: string };
      if (!uuid.safeParse(id).success) return fail(reply, 400, "invalid_id");
      const r = await db.query("UPDATE publishing_events SET status='cancelled',updated_at=now() WHERE id=$1 AND creator_id=$2 AND status='published' RETURNING id,status", [id, userId]);
      if (!r.rowCount) return fail(reply, 404, "not_found");
      return reply.send(r.rows[0]);
    });
  });

  // Dropping an unused upload (never attached to an event) frees its bytes.
  app.delete("/api/publishing/uploads/:id", async (request, reply) => {
    const userId = await who(request, reply, "countrylinqa:write");
    if (!userId) return reply;
    const { id } = request.params as { id: string };
    if (!uuid.safeParse(id).success) return fail(reply, 400, "invalid_id");
    const r = await db.query("DELETE FROM publishing_uploads WHERE id=$1 AND owner_id=$2 AND consumed_event_id IS NULL RETURNING id", [id, userId]);
    if (!r.rowCount) return fail(reply, 404, "not_found");
    await rm(fileFor(userId, id), { force: true });
    return reply.code(204).send();
  });
}
