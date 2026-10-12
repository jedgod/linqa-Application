import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Database } from "../db/pool.js";
import type { SessionService } from "../services/session.service.js";

/**
 * Linking a computer to an account with a QR code.
 *
 *   1. The computer asks for a link and shows the QR (link id + one-time secret). Only the secret's hash is stored.
 *   2. The phone, already signed in on an enrolled device, scans it, sees what it is linking, and approves or denies.
 *   3. The computer claims once. It receives a short-lived enrollment session (profile and device scopes only) and then
 *      registers its own device keys through the existing device-enrollment flow. Nothing is shared except that session.
 *
 * Every step needs the secret, so someone who only learns the link id cannot approve, deny or claim it.
 */
export class DeviceLinkError extends Error {
  constructor(readonly code: "LINK_NOT_FOUND" | "LINK_EXPIRED" | "LINK_NOT_PENDING" | "LINK_NOT_APPROVED" | "LINK_ALREADY_USED" | "INVALID_REQUEST") {
    super(code);
    this.name = "DeviceLinkError";
  }
}

/**
 * Who may unlink whom. A phone can unlink anything on the account. A linked computer can only unlink other computers: a stolen or
 * shared computer must not be able to lock the owner's phone out of the account.
 */
export function mayUnlink(actorPlatform: string, targetPlatform: string): boolean {
  const computer = (platform: string) => platform === "WEB" || platform === "DESKTOP";
  return !computer(actorPlatform) || computer(targetPlatform);
}

export const LINK_TTL_SECONDS = 300;
/** What a freshly claimed link may do: read the profile and list devices, which is all the enrollment flow needs. */
export const LINK_SESSION_SCOPES = ["profile:read", "devices:read"] as const;

const hash = (secret: string) => createHash("sha256").update(secret, "utf8").digest();

type Row = { id: string; secret_hash: Buffer; device_name: string; platform: string; status: string; approved_user_id: string | null; expires_at: Date };

export class DeviceLinkService {
  constructor(private readonly db: Database, private readonly sessions: Pick<SessionService, "create">) {}

  async create(input: { deviceName: string; platform: "WEB" | "DESKTOP" }) {
    const name = input.deviceName.trim().slice(0, 100);
    if (!name) throw new DeviceLinkError("INVALID_REQUEST");
    const secret = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + LINK_TTL_SECONDS * 1000);
    const result = await this.db.query(
      `INSERT INTO device_link_requests (secret_hash, device_name, platform, expires_at) VALUES ($1,$2,$3,$4) RETURNING id`,
      [hash(secret), name, input.platform, expiresAt]
    );
    return { linkId: result.rows[0].id as string, secret, expiresAt };
  }

  /** The row, only when the secret is right. A wrong secret looks exactly like a missing link. */
  private async load(linkId: string, secret: string, forUpdate = false, client: Pick<Database, "query"> = this.db): Promise<Row> {
    if (!/^[0-9a-f-]{36}$/i.test(linkId) || typeof secret !== "string" || secret.length < 20 || secret.length > 100) throw new DeviceLinkError("LINK_NOT_FOUND");
    const result = await client.query(
      `SELECT id, secret_hash, device_name, platform, status, approved_user_id, expires_at FROM device_link_requests WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`,
      [linkId]
    );
    const row = result.rows[0] as Row | undefined;
    const given = hash(secret);
    if (!row || row.secret_hash.length !== given.length || !timingSafeEqual(row.secret_hash, given)) throw new DeviceLinkError("LINK_NOT_FOUND");
    return row;
  }

  private expired(row: Row): boolean {
    return new Date(row.expires_at).getTime() <= Date.now();
  }

  /** What the computer sees while it waits. */
  async status(linkId: string, secret: string): Promise<{ status: "PENDING" | "APPROVED" | "CLAIMED" | "DENIED" | "EXPIRED" }> {
    const row = await this.load(linkId, secret);
    if (this.expired(row) && row.status !== "CLAIMED") return { status: "EXPIRED" };
    return { status: row.status as "PENDING" | "APPROVED" | "CLAIMED" | "DENIED" };
  }

  /** What the phone shows before the person decides. */
  async preview(linkId: string, secret: string) {
    const row = await this.load(linkId, secret);
    if (this.expired(row)) throw new DeviceLinkError("LINK_EXPIRED");
    if (row.status !== "PENDING") throw new DeviceLinkError("LINK_NOT_PENDING");
    return { deviceName: row.device_name, platform: row.platform, expiresAt: row.expires_at };
  }

  async approve(linkId: string, secret: string, userId: string, approvedByDeviceId: string | null) {
    const row = await this.load(linkId, secret);
    if (this.expired(row)) throw new DeviceLinkError("LINK_EXPIRED");
    // One atomic step: only a pending, unexpired request can be approved, and only once.
    const updated = await this.db.query(
      `UPDATE device_link_requests SET status = 'APPROVED', approved_user_id = $2, approved_by_device_id = $3, approved_at = now()
        WHERE id = $1 AND status = 'PENDING' AND expires_at > now() RETURNING id`,
      [linkId, userId, approvedByDeviceId]
    );
    if (updated.rowCount !== 1) throw new DeviceLinkError("LINK_NOT_PENDING");
  }

  async deny(linkId: string, secret: string) {
    await this.load(linkId, secret);
    await this.db.query(`UPDATE device_link_requests SET status = 'DENIED' WHERE id = $1 AND status = 'PENDING'`, [linkId]);
  }

  /** Hands the computer its enrollment session. It works once. */
  async claim(linkId: string, secret: string) {
    const row = await this.load(linkId, secret);
    if (this.expired(row)) throw new DeviceLinkError("LINK_EXPIRED");
    if (row.status === "CLAIMED") throw new DeviceLinkError("LINK_ALREADY_USED");
    if (row.status !== "APPROVED") throw new DeviceLinkError("LINK_NOT_APPROVED");
    const claimed = await this.db.query(
      `UPDATE device_link_requests SET status = 'CLAIMED', claimed_at = now()
        WHERE id = $1 AND status = 'APPROVED' AND expires_at > now() RETURNING approved_user_id`,
      [linkId]
    );
    // Two computers racing to claim: exactly one gets a row back.
    if (claimed.rowCount !== 1) throw new DeviceLinkError("LINK_ALREADY_USED");
    const userId = claimed.rows[0].approved_user_id as string;
    const user = await this.db.query(`SELECT external_subject FROM users WHERE id = $1 AND status = 'ACTIVE'`, [userId]);
    if (user.rowCount !== 1) throw new DeviceLinkError("LINK_NOT_FOUND");
    return this.sessions.create({ userId, subject: user.rows[0].external_subject as string, scopes: [...LINK_SESSION_SCOPES] });
  }

  /** Housekeeping: old requests are not worth keeping. */
  async purgeOld(): Promise<number> {
    const result = await this.db.query(`DELETE FROM device_link_requests WHERE expires_at < now() - interval '1 day'
`);
    return result.rowCount ?? 0;
  }
}
