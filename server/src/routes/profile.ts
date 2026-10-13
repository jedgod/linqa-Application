import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator } from "../auth/jwt.js";
import type { UsernameService } from "../services/username.service.js";
import { validateUsername } from "../profile/username.js";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ImageKind = { mime: "image/jpeg" | "image/png" | "image/webp" };

/** Identify the image by its first bytes, not the client-supplied content type. */
function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg" };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png" };
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return { mime: "image/webp" };
  return null;
}

const USERNAME_ERRORS: Record<string, string> = {
  "username change cooldown active": "You can change your username once every 30 days.",
  "username temporarily unavailable": "That username is not available right now.",
  "invalid username": "Start with a letter. Use only letters, numbers, underscores and dots."
};

export async function registerProfileRoutes(app: FastifyInstance, config: AppConfig, db: Database, usernames: UsernameService) {
  const authenticate = createAuthenticator(config);

  // Avatars arrive as the raw image body so no multipart parser is needed.
  app.addContentTypeParser(["image/jpeg", "image/png", "image/webp"], { parseAs: "buffer", bodyLimit: AVATAR_MAX_BYTES }, (_request, body, done) => done(null, body));

  async function userOf(request: FastifyRequest) {
    try { return (await authenticate(request)).userId; } catch { return null; }
  }

  async function profileOf(userId: string) {
    const result = await db.query(
      `SELECT u.id, n.normalized_username, a.updated_at AS avatar_updated_at
       FROM users u
       LEFT JOIN usernames n ON n.user_id = u.id
       LEFT JOIN user_avatars a ON a.user_id = u.id
       WHERE u.id = $1`, [userId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id as string,
      username: (row.normalized_username as string | null) ?? null,
      avatarUrl: row.avatar_updated_at ? `/v1/profile/${row.id}/avatar?v=${new Date(row.avatar_updated_at).getTime()}` : null
    };
  }

  app.get("/v1/profile/me", async (request, reply) => {
    const userId = await userOf(request);
    if (!userId) return reply.code(401).send({ message: "Sign in again." });
    const profile = await profileOf(userId);
    return profile ? reply.send(profile) : reply.code(404).send({ message: "User not found." });
  });

  app.get("/v1/profile/username-available", async (request, reply) => {
    const userId = await userOf(request);
    if (!userId) return reply.code(401).send({ message: "Sign in again." });
    const raw = (request.query as { username?: unknown }).username;
    const check = validateUsername(raw);
    if (!check.ok) return reply.send({ username: String(raw ?? ""), available: false, reason: check.reason });
    const owner = await db.query("SELECT user_id FROM usernames WHERE normalized_username = $1", [check.username]);
    const held = await db.query("SELECT 1 FROM username_history WHERE normalized_username = $1 AND reusable_after > now() AND user_id <> $2", [check.username, userId]);
    const available = (!owner.rowCount || owner.rows[0].user_id === userId) && !held.rowCount;
    return reply.send({ username: check.username, available, ...(available ? {} : { reason: "That username is taken." }) });
  });

  app.patch("/v1/profile/username", async (request, reply) => {
    const userId = await userOf(request);
    if (!userId) return reply.code(401).send({ message: "Sign in again." });
    const check = validateUsername((request.body as { username?: unknown } | null)?.username);
    if (!check.ok) return reply.code(400).send({ message: check.reason });
    try {
      await usernames.change(userId, check.username);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ message: "That username is taken." });
      const message = error instanceof Error ? error.message : "";
      return reply.code(409).send({ message: USERNAME_ERRORS[message] ?? "Could not save that username." });
    }
    return reply.send(await profileOf(userId));
  });

  app.put("/v1/profile/avatar", async (request, reply) => {
    const userId = await userOf(request);
    if (!userId) return reply.code(401).send({ message: "Sign in again." });
    const body = request.body;
    if (!Buffer.isBuffer(body) || !body.length) return reply.code(400).send({ message: "No image received." });
    const kind = sniffImage(body);
    if (!kind) return reply.code(400).send({ message: "Use a JPEG, PNG or WebP image." });
    await db.query(
      `INSERT INTO user_avatars (user_id, mime, image, updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (user_id) DO UPDATE SET mime = EXCLUDED.mime, image = EXCLUDED.image, updated_at = now()`,
      [userId, kind.mime, body]);
    return reply.send(await profileOf(userId));
  });

  app.delete("/v1/profile/avatar", async (request, reply) => {
    const userId = await userOf(request);
    if (!userId) return reply.code(401).send({ message: "Sign in again." });
    await db.query("DELETE FROM user_avatars WHERE user_id = $1", [userId]);
    return reply.send(await profileOf(userId));
  });

  // Only signed-in Linqa users can see avatars.
  app.get("/v1/profile/:id/avatar", async (request, reply) => {
    if (!(await userOf(request))) return reply.code(401).send({ message: "Sign in again." });
    const { id } = request.params as { id: string };
    if (!UUID.test(id)) return reply.code(404).send({ message: "No avatar" });
    const result = await db.query("SELECT mime, image FROM user_avatars WHERE user_id = $1", [id]);
    if (!result.rowCount) return reply.code(404).send({ message: "No avatar" });
    return reply
      .header("Content-Type", result.rows[0].mime)
      .header("Cache-Control", "private, max-age=86400")
      .header("X-Content-Type-Options", "nosniff")
      .send(result.rows[0].image);
  });
}
