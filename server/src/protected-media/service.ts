// Protected photos: view limits, time windows, screenshot/recording revocation and a
// tamper-evident audit trail. The server holds ciphertext only; the key is inside the
// end-to-end encrypted chat message.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import type { Database } from "../db/pool.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { hashEvent, verifyChain, type ChainCheck } from "./audit-chain.js";
import { parsePolicy, PolicyError, type PolicyInput } from "./policy.js";

export const MAX_CIPHERTEXT_BYTES = 15 * 1024 * 1024;
/** A granted view must download its ciphertext within this time. */
const TOKEN_TTL_MS = 30_000;
/** Media nobody opens is closed after this long, whatever the mode. */
const MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

type Status = "ACTIVE" | "EXHAUSTED" | "EXPIRED" | "REVOKED" | "CAPTURE_REVOKED";
type ClosingStatus = Exclude<Status, "ACTIVE">;
type AuditType =
  | "CREATED" | "VIEW_GRANTED" | "BLOB_DELIVERED" | "VIEW_ENDED" | "ACCESS_DENIED"
  | "SCREENSHOT_DETECTED" | "SCREEN_RECORDING_DETECTED" | "EXHAUSTED" | "EXPIRED"
  | "REVOKED_BY_SENDER" | "CAPTURE_REVOKED" | "BLOB_DELETED";

export type SenderAlertType = "VIEWED" | "SCREENSHOT" | "SCREEN_RECORDING" | "EXHAUSTED" | "EXPIRED" | "CAPTURE_REVOKED";

export class MediaHttpError extends Error {
  constructor(readonly status: number, message: string, readonly mediaStatus?: string) {
    super(message);
  }
}

type MediaRow = {
  id: string;
  senderId: string;
  recipientId: string;
  conversationId: string | null;
  mode: "MULTI_VIEW" | "TIMED" | "EPHEMERAL";
  maxViews: number | null;
  windowSeconds: number | null;
  expiryStart: "ON_SEND" | "ON_FIRST_VIEW" | null;
  viewSeconds: number;
  notifyOnView: boolean;
  revokeOnCapture: boolean;
  hasBlob: boolean;
  sizeBytes: number;
  viewCount: number;
  status: Status;
  createdAt: Date;
  firstViewedAt: Date | null;
  expiresAt: Date | null;
  closedAt: Date | null;
};

const COLUMNS = `id, sender_id, recipient_id, conversation_id, mode, max_views, window_seconds, expiry_start,
  view_seconds, notify_on_view, revoke_on_capture, (blob IS NOT NULL) AS has_blob, size_bytes, view_count, status,
  created_at, first_viewed_at, expires_at, closed_at`;

function toMedia(r: Record<string, any>): MediaRow {
  return {
    id: r.id, senderId: r.sender_id, recipientId: r.recipient_id, conversationId: r.conversation_id,
    mode: r.mode, maxViews: r.max_views, windowSeconds: r.window_seconds, expiryStart: r.expiry_start,
    viewSeconds: r.view_seconds, notifyOnView: r.notify_on_view, revokeOnCapture: r.revoke_on_capture,
    hasBlob: r.has_blob, sizeBytes: r.size_bytes, viewCount: r.view_count, status: r.status,
    createdAt: r.created_at, firstViewedAt: r.first_viewed_at, expiresAt: r.expires_at, closedAt: r.closed_at
  };
}

export type ClientInfo = { platform?: string; osVersion?: string; appVersion?: string };
export type EndReason = "timer" | "closed" | "capture" | "background" | "expired";
const END_REASONS: EndReason[] = ["timer", "closed", "capture", "background", "expired"];

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function cleanClientInfo(info: unknown): ClientInfo {
  const src = (info ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof src[k] === "string" ? (src[k] as string).slice(0, 40) : undefined);
  const out: ClientInfo = {};
  for (const key of ["platform", "osVersion", "appVersion"] as const) {
    const value = pick(key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export class ProtectedMediaService {
  constructor(private readonly db: Database, private readonly hub: Pick<RealtimeHub, "sendToUser">) {}

  private async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Append one event to a media item's chain. The caller holds the media row lock. */
  private async audit(
    client: PoolClient, mediaId: string, type: AuditType, actorId: string | null,
    viewNumber: number | null = null, detail: Record<string, unknown> | null = null
  ) {
    const last = await client.query("SELECT seq, hash FROM protected_media_audit WHERE media_id = $1 ORDER BY seq DESC LIMIT 1", [mediaId]);
    const seq = (last.rows[0]?.seq ?? 0) + 1;
    const prevHash: string | null = last.rows[0]?.hash ?? null;
    const at = new Date();
    // Round-trip through JSON so the hashed form equals what the database returns.
    const cleanDetail = detail ? (JSON.parse(JSON.stringify(detail)) as Record<string, unknown>) : null;
    const hash = hashEvent({ mediaId, seq, type, actorId, viewNumber, at, detail: cleanDetail, prevHash });
    await client.query(
      `INSERT INTO protected_media_audit (media_id, seq, type, actor_id, view_number, at, detail, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [mediaId, seq, type, actorId, viewNumber, at, cleanDetail ? JSON.stringify(cleanDetail) : null, prevHash, hash]
    );
  }

  private async lockMedia(client: PoolClient, mediaId: string): Promise<MediaRow | null> {
    const result = await client.query(`SELECT ${COLUMNS} FROM protected_media WHERE id = $1 FOR UPDATE`, [mediaId]);
    return result.rows[0] ? toMedia(result.rows[0]) : null;
  }

  // ----- create ------------------------------------------------------------

  async create(
    senderId: string,
    input: { recipientId: unknown; conversationId: unknown; policy: unknown },
    blob: Buffer | undefined
  ) {
    if (!blob?.length) throw new MediaHttpError(400, "No encrypted file received.");
    if (blob.length > MAX_CIPHERTEXT_BYTES) throw new MediaHttpError(400, "File is too large.");
    const recipientId = typeof input.recipientId === "string" ? input.recipientId : "";
    const conversationId = typeof input.conversationId === "string" ? input.conversationId : "";
    if (!recipientId || !conversationId) throw new MediaHttpError(400, "recipientId and conversationId are required.");
    if (recipientId === senderId) throw new MediaHttpError(400, "You cannot send protected media to yourself.");

    // Both people must be active members of this conversation.
    const member = await this.db.query(
      `SELECT 1 FROM conversation_members a
       JOIN conversation_members b ON b.conversation_id = a.conversation_id
       WHERE a.conversation_id = $1 AND a.user_id = $2 AND a.removed_at IS NULL
         AND b.user_id = $3 AND b.removed_at IS NULL`,
      [conversationId, senderId, recipientId]
    );
    if (!member.rowCount) throw new MediaHttpError(403, "You can only send this to someone in the conversation.");

    let policyInput: PolicyInput;
    try {
      policyInput = typeof input.policy === "string" ? JSON.parse(input.policy) : ((input.policy ?? {}) as PolicyInput);
    } catch {
      throw new MediaHttpError(400, "policy must be JSON.");
    }
    let policy;
    try {
      policy = parsePolicy(policyInput);
    } catch (error) {
      if (error instanceof PolicyError) throw new MediaHttpError(400, error.message);
      throw error;
    }

    const id = randomUUID();
    const now = new Date();
    const expiresAt = policy.mode === "TIMED" && policy.expiryStart === "ON_SEND"
      ? new Date(now.getTime() + policy.windowSeconds! * 1000) : null;

    return this.tx(async (client) => {
      const inserted = await client.query(
        `INSERT INTO protected_media (id, sender_id, recipient_id, conversation_id, mode, max_views, window_seconds,
           expiry_start, view_seconds, notify_on_view, revoke_on_capture, blob, size_bytes, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING ${COLUMNS}`,
        [id, senderId, recipientId, conversationId, policy.mode, policy.maxViews, policy.windowSeconds, policy.expiryStart,
          policy.viewSeconds, policy.notifyOnView, policy.revokeOnCapture, blob, blob.length, now, expiresAt]
      );
      await this.audit(client, id, "CREATED", senderId, null, {
        mode: policy.mode, maxViews: policy.maxViews, windowSeconds: policy.windowSeconds, expiryStart: policy.expiryStart,
        viewSeconds: policy.viewSeconds, revokeOnCapture: policy.revokeOnCapture, sizeBytes: blob.length
      });
      return this.toPublic(toMedia(inserted.rows[0]), senderId);
    });
  }

  // ----- viewing -----------------------------------------------------------

  private denial(m: MediaRow, now: Date): string | null {
    if (m.status !== "ACTIVE") return m.status;
    if (!m.hasBlob) return "DELETED";
    if (m.expiresAt && now >= m.expiresAt) return "EXPIRED";
    if (now.getTime() - m.createdAt.getTime() > MAX_LIFETIME_MS) return "EXPIRED";
    if (m.maxViews !== null && m.viewCount >= m.maxViews) return "EXHAUSTED";
    return null;
  }

  /** Step 1 of a view: count it, audit it, and hand back a single-use download token. */
  async requestView(mediaId: string, viewerId: string, clientInfo: unknown) {
    const info = cleanClientInfo(clientInfo);
    const result = await this.tx(async (client) => {
      const m = await this.lockMedia(client, mediaId);
      // Hide existence from anyone but the recipient. The sender cannot spend views either.
      if (!m || m.recipientId !== viewerId) throw new MediaHttpError(404, "Not found.");

      const now = new Date();
      const reason = this.denial(m, now);
      if (reason) {
        await this.audit(client, mediaId, "ACCESS_DENIED", viewerId, null, { reason, ...info });
        return { denied: reason, media: m, grant: null } as const;
      }

      let expiresAt = m.expiresAt;
      const firstViewedAt = m.firstViewedAt ?? now;
      if (m.mode === "TIMED" && m.expiryStart === "ON_FIRST_VIEW" && !m.firstViewedAt) {
        expiresAt = new Date(now.getTime() + m.windowSeconds! * 1000);
      }
      const viewNumber = m.viewCount + 1;
      await client.query(
        "UPDATE protected_media SET view_count = $2, first_viewed_at = $3, expires_at = $4 WHERE id = $1",
        [mediaId, viewNumber, firstViewedAt, expiresAt]
      );
      const token = randomBytes(32).toString("base64url");
      const tokenExpiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
      const view = await client.query(
        `INSERT INTO protected_media_views (media_id, viewer_id, view_number, token_hash, token_expires_at, started_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [mediaId, viewerId, viewNumber, sha256(token), tokenExpiresAt, now]
      );
      await this.audit(client, mediaId, "VIEW_GRANTED", viewerId, viewNumber, { viewId: view.rows[0].id, ...info });

      const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)) : null;
      return {
        denied: null,
        media: m,
        grant: {
          viewId: view.rows[0].id as string,
          token,
          viewNumber,
          remainingViews: m.maxViews === null ? null : m.maxViews - viewNumber,
          displaySeconds: secondsLeft === null ? m.viewSeconds : Math.min(m.viewSeconds, secondsLeft),
          expiresAt: expiresAt?.toISOString() ?? null,
          tokenExpiresAt: tokenExpiresAt.toISOString(),
          revokeOnCapture: m.revokeOnCapture
        }
      } as const;
    });

    if (!result.grant) {
      if (result.denied === "EXPIRED" && result.media.status === "ACTIVE") await this.close(mediaId, "EXPIRED", null, "time window ended");
      throw new MediaHttpError(410, "This photo is no longer available.", result.denied ?? undefined);
    }
    if (result.media.notifyOnView) this.alertSender(result.media, "VIEWED", result.grant.viewNumber, result.grant.remainingViews);
    return result.grant;
  }

  /** Step 2: the ciphertext, once per granted view. The final allowed view closes and wipes the media. */
  async fetchCiphertext(mediaId: string, viewId: string, viewerId: string, token: unknown): Promise<Buffer> {
    if (!token || typeof token !== "string") throw new MediaHttpError(404, "Not found.");

    const { bytes, isFinal, viewNumber } = await this.tx(async (client) => {
      const viewResult = await client.query("SELECT * FROM protected_media_views WHERE id = $1 FOR UPDATE", [viewId]);
      const view = viewResult.rows[0];
      if (!view || view.media_id !== mediaId || view.viewer_id !== viewerId) throw new MediaHttpError(404, "Not found.");
      if (!safeEqualHex(view.token_hash, sha256(token))) throw new MediaHttpError(404, "Not found.");

      const now = new Date();
      if (view.blob_fetched_at) throw new MediaHttpError(410, "This view was already used.");
      if (new Date(view.token_expires_at) <= now) throw new MediaHttpError(410, "This view request timed out.");

      const m = await this.lockMedia(client, mediaId);
      if (!m || m.status !== "ACTIVE" || !m.hasBlob) throw new MediaHttpError(410, "This photo is no longer available.");
      if (m.expiresAt && now >= m.expiresAt) throw new MediaHttpError(410, "This photo has expired.");

      const blob = await client.query("SELECT blob FROM protected_media WHERE id = $1", [mediaId]);
      await client.query("UPDATE protected_media_views SET blob_fetched_at = $2 WHERE id = $1", [viewId, now]);
      await this.audit(client, mediaId, "BLOB_DELIVERED", viewerId, view.view_number, { viewId });
      return {
        bytes: blob.rows[0].blob as Buffer,
        isFinal: m.maxViews !== null && view.view_number >= m.maxViews,
        viewNumber: view.view_number as number
      };
    });

    if (isFinal) await this.close(mediaId, "EXHAUSTED", null, `view limit reached on view ${viewNumber}`);
    return bytes;
  }

  /** Step 3: the viewer reports when it closed and why. */
  async endView(mediaId: string, viewId: string, viewerId: string, reason: unknown) {
    const why: EndReason = END_REASONS.includes(reason as EndReason) ? (reason as EndReason) : "closed";
    await this.tx(async (client) => {
      const media = await this.lockMedia(client, mediaId);
      const viewResult = await client.query("SELECT * FROM protected_media_views WHERE id = $1 FOR UPDATE", [viewId]);
      const view = viewResult.rows[0];
      if (!media || !view || view.media_id !== mediaId || view.viewer_id !== viewerId) throw new MediaHttpError(404, "Not found.");
      if (view.ended_at) return;
      const now = new Date();
      await client.query("UPDATE protected_media_views SET ended_at = $2, end_reason = $3 WHERE id = $1", [viewId, now, why]);
      await this.audit(client, mediaId, "VIEW_ENDED", viewerId, view.view_number, {
        viewId, reason: why, durationMs: now.getTime() - new Date(view.started_at).getTime()
      });
    });
    return { ok: true };
  }

  // ----- capture -----------------------------------------------------------

  /** A screenshot or screen recording happened while the photo was on screen. Always reported; ephemeral photos are revoked. */
  async reportCapture(mediaId: string, viewerId: string, kind: unknown, viewId: unknown, clientInfo: unknown) {
    if (kind !== "screenshot" && kind !== "recording") throw new MediaHttpError(400, "kind must be screenshot or recording.");
    const info = cleanClientInfo(clientInfo);
    const m = await this.tx(async (client) => {
      const media = await this.lockMedia(client, mediaId);
      if (!media || media.recipientId !== viewerId) throw new MediaHttpError(404, "Not found.");
      await this.audit(client, mediaId, kind === "screenshot" ? "SCREENSHOT_DETECTED" : "SCREEN_RECORDING_DETECTED", viewerId, null,
        { viewId: typeof viewId === "string" ? viewId : null, ...info });
      return media;
    });
    this.alertSender(m, kind === "screenshot" ? "SCREENSHOT" : "SCREEN_RECORDING");
    if (m.revokeOnCapture && m.status === "ACTIVE") {
      await this.close(mediaId, "CAPTURE_REVOKED", viewerId, `${kind} detected`);
      return { revoked: true };
    }
    return { revoked: false };
  }

  // ----- sender actions and reads -------------------------------------------

  async revoke(mediaId: string, senderId: string) {
    const found = await this.db.query("SELECT sender_id FROM protected_media WHERE id = $1", [mediaId]);
    if (!found.rowCount) throw new MediaHttpError(404, "Not found.");
    if (found.rows[0].sender_id !== senderId) throw new MediaHttpError(403, "Only the sender can revoke this.");
    await this.close(mediaId, "REVOKED", senderId, "revoked by sender");
    return this.getStatus(mediaId, senderId);
  }

  private async loadForParticipant(mediaId: string, userId: string): Promise<MediaRow> {
    const result = await this.db.query(`SELECT ${COLUMNS} FROM protected_media WHERE id = $1`, [mediaId]);
    const m = result.rows[0] ? toMedia(result.rows[0]) : null;
    if (!m || (m.senderId !== userId && m.recipientId !== userId)) throw new MediaHttpError(404, "Not found.");
    return m;
  }

  async getStatus(mediaId: string, userId: string) {
    const m = await this.loadForParticipant(mediaId, userId);
    // Close lazily if the sweeper has not run yet.
    if (m.status === "ACTIVE" && this.denial(m, new Date()) === "EXPIRED") {
      await this.close(mediaId, "EXPIRED", null, "time window ended");
      return this.toPublic(await this.loadForParticipant(mediaId, userId), userId);
    }
    return this.toPublic(m, userId);
  }

  async getAudit(mediaId: string, userId: string) {
    const m = await this.loadForParticipant(mediaId, userId);
    const result = await this.db.query("SELECT * FROM protected_media_audit WHERE media_id = $1 ORDER BY seq ASC", [mediaId]);
    const rows = result.rows.map((r) => ({
      mediaId: r.media_id as string, seq: r.seq as number, type: r.type as string, actorId: (r.actor_id ?? null) as string | null,
      viewNumber: (r.view_number ?? null) as number | null, at: r.at as Date, detail: r.detail ?? null,
      prevHash: (r.prev_hash ?? null) as string | null, hash: r.hash as string
    }));
    let integrity: ChainCheck;
    try {
      integrity = verifyChain(rows);
    } catch {
      integrity = { valid: false, brokenAtSeq: 0, reason: "Could not verify" };
    }
    return {
      media: this.toPublic(m, userId),
      integrity,
      events: rows.map((r) => ({
        seq: r.seq, type: r.type, at: r.at.toISOString(),
        actor: r.actorId === m.senderId ? "sender" : r.actorId === m.recipientId ? "recipient" : "system",
        actorId: r.actorId, viewNumber: r.viewNumber, detail: r.detail, hash: r.hash
      }))
    };
  }

  // ----- closing -----------------------------------------------------------

  /** Move ACTIVE media to a final status, audit it, wipe the ciphertext, alert the sender. */
  async close(mediaId: string, status: ClosingStatus, actorId: string | null, reason: string) {
    const auditType: Record<ClosingStatus, AuditType> = {
      EXHAUSTED: "EXHAUSTED", EXPIRED: "EXPIRED", REVOKED: "REVOKED_BY_SENDER", CAPTURE_REVOKED: "CAPTURE_REVOKED"
    };
    const closed = await this.tx(async (client) => {
      const m = await this.lockMedia(client, mediaId);
      if (!m || m.status !== "ACTIVE") return null;
      await client.query(
        "UPDATE protected_media SET status = $2, closed_at = now(), close_reason = $3, blob = NULL WHERE id = $1",
        [mediaId, status, reason]
      );
      await this.audit(client, mediaId, auditType[status], actorId, null, { reason });
      if (m.hasBlob) await this.audit(client, mediaId, "BLOB_DELETED", null, null, null);
      return m;
    });
    if (closed && status !== "REVOKED") {
      this.alertSender(closed, status === "EXHAUSTED" ? "EXHAUSTED" : status === "EXPIRED" ? "EXPIRED" : "CAPTURE_REVOKED");
    }
  }

  /** Runs on a timer. Closing is idempotent, so more than one API instance is safe. */
  async sweep(now = new Date()): Promise<number> {
    let closedCount = 0;
    const expired = await this.db.query(
      `SELECT id FROM protected_media WHERE status = 'ACTIVE' AND (expires_at <= $1 OR created_at <= $2) LIMIT 500`,
      [now, new Date(now.getTime() - MAX_LIFETIME_MS)]
    );
    for (const row of expired.rows) {
      await this.close(row.id, "EXPIRED", null, "time window ended");
      closedCount++;
    }
    // A final view that was granted but never downloaded: close once its token has lapsed.
    const stale = await this.db.query(
      `SELECT DISTINCT m.id FROM protected_media m JOIN protected_media_views v ON v.media_id = m.id
       WHERE m.status = 'ACTIVE' AND m.max_views IS NOT NULL AND m.view_count >= m.max_views
         AND v.blob_fetched_at IS NULL AND v.token_expires_at <= $1 LIMIT 500`,
      [now]
    );
    for (const row of stale.rows) {
      await this.close(row.id, "EXHAUSTED", null, "final view was not opened in time");
      closedCount++;
    }
    return closedCount;
  }

  // ----- helpers -----------------------------------------------------------

  private alertSender(m: MediaRow, type: SenderAlertType, viewNumber: number | null = null, remainingViews: number | null = null) {
    this.hub.sendToUser(m.senderId, {
      type: "protected-media.alert",
      alert: { type, mediaId: m.id, conversationId: m.conversationId, viewNumber, remainingViews, at: new Date().toISOString() }
    });
  }

  toPublic(m: MediaRow, userId: string) {
    return {
      id: m.id,
      role: m.senderId === userId ? ("sender" as const) : ("recipient" as const),
      mode: m.mode,
      status: m.status,
      maxViews: m.maxViews,
      viewCount: m.viewCount,
      remainingViews: m.maxViews === null ? null : Math.max(0, m.maxViews - m.viewCount),
      windowSeconds: m.windowSeconds,
      expiryStart: m.expiryStart,
      viewSeconds: m.viewSeconds,
      notifyOnView: m.notifyOnView,
      revokeOnCapture: m.revokeOnCapture,
      createdAt: m.createdAt.toISOString(),
      firstViewedAt: m.firstViewedAt?.toISOString() ?? null,
      expiresAt: m.expiresAt?.toISOString() ?? null,
      closedAt: m.closedAt?.toISOString() ?? null
    };
  }
}
