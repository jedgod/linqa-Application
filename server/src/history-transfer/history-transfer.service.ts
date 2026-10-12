import type { Database } from "../db/pool.js";

/**
 * Moving older history to a newly linked computer.
 *
 *   REQUESTED  the computer asked
 *   APPROVED   a phone said yes (the phone then builds and uploads the archive)
 *   UPLOADING  chunks are arriving
 *   READY      all chunks are there; the computer can download them
 *   COMPLETE   the computer has them; the chunks are deleted
 *   CANCELLED / DECLINED / FAILED   ended early; the chunks are deleted
 *
 * Every chunk is already sealed for the computer by the phone: this service moves ciphertext and keeps no keys. Only a phone of the
 * same account can approve or upload, only the requesting computer can download or complete, and nothing outlives its window.
 */
export class HistoryTransferError extends Error {
  constructor(readonly code:
    | "NOT_FOUND" | "NOT_ALLOWED" | "WRONG_STATE" | "EXPIRED" | "ALREADY_OPEN" | "TOO_LARGE" | "BAD_CHUNK" | "INCOMPLETE" | "PHONE_REQUIRED" | "COMPUTER_REQUIRED") {
    super(code);
    this.name = "HistoryTransferError";
  }
}

export type TransferStatus = "REQUESTED" | "APPROVED" | "UPLOADING" | "READY" | "COMPLETE" | "CANCELLED" | "DECLINED" | "FAILED";

export const LIMITS = {
  requestWindowMs: 10 * 60_000,
  transferWindowMs: 60 * 60_000,
  chunkBytes: 256 * 1024,
  maxChunks: 1500,
  maxTotalBytes: 160 * 1024 * 1024,
  phoneOnlineMs: 45_000
} as const;

const isComputer = (platform: string) => platform === "WEB" || platform === "DESKTOP";
const OPEN: TransferStatus[] = ["REQUESTED", "APPROVED", "UPLOADING", "READY"];

interface Row {
  id: string; user_id: string; requester_device_id: string; approver_device_id: string | null; status: TransferStatus;
  chunk_count: number | null; total_bytes: string | null; progress_done: number; progress_total: number | null; failure_code: string | null; expires_at: Date;
}

export interface TransferView {
  id: string;
  status: TransferStatus;
  /** True when the window ran out before the transfer finished. */
  expired: boolean;
  chunkCount: number | null;
  progress: { done: number; total: number | null };
  failure: string | null;
  /** Whether a phone of this account has checked in recently, so the computer can say "your phone is offline". */
  phoneOnline: boolean;
  requesterName: string | null;
  approverDeviceId: string | null;
}

export class HistoryTransferService {
  constructor(private readonly db: Database) {}

  private async platformOf(userId: string, deviceId: string): Promise<string> {
    const result = await this.db.query(`SELECT platform FROM devices WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE'`, [deviceId, userId]);
    return (result.rows[0]?.platform as string | undefined) ?? "";
  }

  private async load(id: string, userId: string): Promise<Row> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HistoryTransferError("NOT_FOUND");
    const result = await this.db.query(`SELECT * FROM history_transfers WHERE id = $1 AND user_id = $2`, [id, userId]);
    const row = result.rows[0] as Row | undefined;
    if (!row) throw new HistoryTransferError("NOT_FOUND");
    return row;
  }

  private isExpired(row: Row): boolean {
    return OPEN.includes(row.status) && new Date(row.expires_at).getTime() <= Date.now();
  }

  /** Ends a transfer whose window ran out, so its chunks do not linger. */
  private async expireIfNeeded(row: Row): Promise<Row> {
    if (!this.isExpired(row)) return row;
    await this.end(row.id, "FAILED", "EXPIRED");
    return { ...row, status: "FAILED", failure_code: "EXPIRED" };
  }

  private async end(id: string, status: TransferStatus, failure: string | null = null): Promise<void> {
    await this.db.query(`DELETE FROM history_transfer_chunks WHERE transfer_id = $1`, [id]);
    await this.db.query(`UPDATE history_transfers SET status = $2, failure_code = $3, updated_at = now() WHERE id = $1`, [id, status, failure]);
  }

  /** A linked computer asks for its history. One open request per computer. */
  async request(userId: string, deviceId: string): Promise<{ id: string }> {
    const platform = await this.platformOf(userId, deviceId);
    if (!isComputer(platform)) throw new HistoryTransferError("COMPUTER_REQUIRED");
    // A stale open request from an earlier visit is closed first, so it cannot block a new one.
    const stale = await this.db.query(`SELECT id FROM history_transfers WHERE requester_device_id = $1 AND status = ANY($2::text[]) AND expires_at <= now()`, [deviceId, OPEN]);
    for (const row of stale.rows) await this.end(row.id as string, "FAILED", "EXPIRED");
    try {
      const inserted = await this.db.query(
        `INSERT INTO history_transfers (user_id, requester_device_id, expires_at) VALUES ($1,$2,$3) RETURNING id`,
        [userId, deviceId, new Date(Date.now() + LIMITS.requestWindowMs)]
      );
      return { id: inserted.rows[0].id as string };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new HistoryTransferError("ALREADY_OPEN");
      throw error;
    }
  }

  async view(userId: string, id: string): Promise<TransferView> {
    const row = await this.expireIfNeeded(await this.load(id, userId));
    const requester = await this.db.query(`SELECT device_name FROM devices WHERE id = $1`, [row.requester_device_id]);
    const phones = await this.db.query(
      `SELECT 1 FROM devices WHERE user_id = $1 AND status = 'ACTIVE' AND platform IN ('ANDROID','IOS') AND last_seen_at > now() - ($2 || ' milliseconds')::interval LIMIT 1`,
      [userId, String(LIMITS.phoneOnlineMs)]
    );
    return {
      id: row.id,
      status: row.status,
      expired: row.failure_code === "EXPIRED",
      chunkCount: row.chunk_count,
      progress: { done: row.progress_done, total: row.progress_total },
      failure: row.failure_code,
      phoneOnline: phones.rowCount === 1,
      requesterName: (requester.rows[0]?.device_name as string | undefined) ?? null,
      approverDeviceId: row.approver_device_id
    };
  }

  /** What a phone is asked to approve. Asking also counts as the phone being online. */
  async pendingFor(userId: string, phoneDeviceId: string): Promise<Array<{ id: string; computerName: string; requestedAt: Date }>> {
    if (isComputer(await this.platformOf(userId, phoneDeviceId))) throw new HistoryTransferError("PHONE_REQUIRED");
    await this.db.query(`UPDATE devices SET last_seen_at = now() WHERE id = $1 AND user_id = $2`, [phoneDeviceId, userId]);
    const result = await this.db.query(
      `SELECT t.id, d.device_name AS "computerName", t.created_at AS "requestedAt"
         FROM history_transfers t JOIN devices d ON d.id = t.requester_device_id
        WHERE t.user_id = $1 AND t.status = 'REQUESTED' AND t.expires_at > now() AND d.status = 'ACTIVE' ORDER BY t.created_at`,
      [userId]
    );
    return result.rows;
  }

  async approve(userId: string, phoneDeviceId: string, id: string): Promise<{ computerDeviceId: string }> {
    if (isComputer(await this.platformOf(userId, phoneDeviceId))) throw new HistoryTransferError("PHONE_REQUIRED");
    const row = await this.expireIfNeeded(await this.load(id, userId));
    if (row.status === "FAILED" && row.failure_code === "EXPIRED") throw new HistoryTransferError("EXPIRED");
    // One atomic step: only a request still waiting can be approved, and only once.
    const updated = await this.db.query(
      `UPDATE history_transfers SET status = 'APPROVED', approver_device_id = $2, expires_at = $3, updated_at = now()
        WHERE id = $1 AND status = 'REQUESTED' AND expires_at > now() RETURNING requester_device_id`,
      [id, phoneDeviceId, new Date(Date.now() + LIMITS.transferWindowMs)]
    );
    if (updated.rowCount !== 1) throw new HistoryTransferError("WRONG_STATE");
    return { computerDeviceId: updated.rows[0].requester_device_id as string };
  }

  async decline(userId: string, phoneDeviceId: string, id: string): Promise<void> {
    if (isComputer(await this.platformOf(userId, phoneDeviceId))) throw new HistoryTransferError("PHONE_REQUIRED");
    const row = await this.load(id, userId);
    if (row.status !== "REQUESTED") throw new HistoryTransferError("WRONG_STATE");
    await this.end(id, "DECLINED");
  }

  /** The approving phone stores one sealed chunk. Re-sending a chunk replaces it. */
  async putChunk(userId: string, phoneDeviceId: string, id: string, seq: number, data: Buffer, progress?: { done: number; total: number }): Promise<void> {
    const row = await this.expireIfNeeded(await this.load(id, userId));
    if (row.approver_device_id !== phoneDeviceId) throw new HistoryTransferError("NOT_ALLOWED");
    if (row.status === "FAILED" && row.failure_code === "EXPIRED") throw new HistoryTransferError("EXPIRED");
    if (row.status !== "APPROVED" && row.status !== "UPLOADING") throw new HistoryTransferError("WRONG_STATE");
    if (!Number.isInteger(seq) || seq < 0 || seq >= LIMITS.maxChunks) throw new HistoryTransferError("BAD_CHUNK");
    if (data.length === 0 || data.length > LIMITS.chunkBytes) throw new HistoryTransferError("BAD_CHUNK");
    const total = await this.db.query(`SELECT COALESCE(SUM(length(data)),0)::bigint AS bytes FROM history_transfer_chunks WHERE transfer_id = $1 AND seq <> $2`, [id, seq]);
    if (Number(total.rows[0].bytes) + data.length > LIMITS.maxTotalBytes) throw new HistoryTransferError("TOO_LARGE");
    await this.db.query(
      `INSERT INTO history_transfer_chunks (transfer_id, seq, data) VALUES ($1,$2,$3) ON CONFLICT (transfer_id, seq) DO UPDATE SET data = EXCLUDED.data`,
      [id, seq, data]
    );
    await this.db.query(
      `UPDATE history_transfers SET status = 'UPLOADING', progress_done = COALESCE($2, progress_done), progress_total = COALESCE($3, progress_total), updated_at = now() WHERE id = $1`,
      [id, progress?.done ?? null, progress?.total ?? null]
    );
  }

  /** The phone says it is done: the count must match what arrived, with no gaps. */
  async finish(userId: string, phoneDeviceId: string, id: string, chunkCount: number): Promise<void> {
    const row = await this.expireIfNeeded(await this.load(id, userId));
    if (row.approver_device_id !== phoneDeviceId) throw new HistoryTransferError("NOT_ALLOWED");
    if (row.status !== "APPROVED" && row.status !== "UPLOADING") throw new HistoryTransferError("WRONG_STATE");
    if (!Number.isInteger(chunkCount) || chunkCount < 0 || chunkCount > LIMITS.maxChunks) throw new HistoryTransferError("BAD_CHUNK");
    const stored = await this.db.query(`SELECT count(*)::int AS n, COALESCE(max(seq),-1)::int AS top, COALESCE(sum(length(data)),0)::bigint AS bytes FROM history_transfer_chunks WHERE transfer_id = $1`, [id]);
    const { n, top, bytes } = stored.rows[0] as { n: number; top: number; bytes: string };
    if (n !== chunkCount || (chunkCount > 0 && top !== chunkCount - 1)) throw new HistoryTransferError("INCOMPLETE");
    await this.db.query(
      `UPDATE history_transfers SET status = 'READY', chunk_count = $2, total_bytes = $3, progress_done = $2, progress_total = $2, updated_at = now() WHERE id = $1`,
      [id, chunkCount, bytes]
    );
  }

  /** The phone could not build the archive. The computer is told, and nothing is kept. */
  async fail(userId: string, phoneDeviceId: string, id: string, code: string): Promise<void> {
    const row = await this.load(id, userId);
    if (row.approver_device_id !== phoneDeviceId) throw new HistoryTransferError("NOT_ALLOWED");
    if (!OPEN.includes(row.status)) throw new HistoryTransferError("WRONG_STATE");
    await this.end(id, "FAILED", code.replace(/[^A-Z0-9_]/g, "").slice(0, 40) || "PHONE_FAILED");
  }

  async getChunk(userId: string, computerDeviceId: string, id: string, seq: number): Promise<Buffer> {
    const row = await this.expireIfNeeded(await this.load(id, userId));
    if (row.requester_device_id !== computerDeviceId) throw new HistoryTransferError("NOT_ALLOWED");
    if (row.status !== "READY") throw new HistoryTransferError(row.status === "FAILED" && row.failure_code === "EXPIRED" ? "EXPIRED" : "WRONG_STATE");
    const result = await this.db.query(`SELECT data FROM history_transfer_chunks WHERE transfer_id = $1 AND seq = $2`, [id, seq]);
    if (result.rowCount !== 1) throw new HistoryTransferError("NOT_FOUND");
    return result.rows[0].data as Buffer;
  }

  /** The computer has everything: the chunks are deleted. */
  async complete(userId: string, computerDeviceId: string, id: string): Promise<void> {
    const row = await this.load(id, userId);
    if (row.requester_device_id !== computerDeviceId) throw new HistoryTransferError("NOT_ALLOWED");
    if (row.status !== "READY") throw new HistoryTransferError("WRONG_STATE");
    await this.end(id, "COMPLETE");
  }

  /** Either side can stop an open transfer. */
  async cancel(userId: string, deviceId: string, id: string): Promise<void> {
    const row = await this.load(id, userId);
    if (row.requester_device_id !== deviceId && row.approver_device_id !== deviceId) throw new HistoryTransferError("NOT_ALLOWED");
    if (!OPEN.includes(row.status)) return;
    await this.end(id, "CANCELLED");
  }

  /** Housekeeping: finished and abandoned transfers are not worth keeping. */
  async purge(): Promise<number> {
    await this.db.query(`UPDATE history_transfers SET status = 'FAILED', failure_code = 'EXPIRED' WHERE status = ANY($1::text[]) AND expires_at <= now()`, [OPEN]);
    await this.db.query(`DELETE FROM history_transfer_chunks WHERE transfer_id IN (SELECT id FROM history_transfers WHERE status NOT IN ('APPROVED','UPLOADING','READY'))`);
    const result = await this.db.query(`DELETE FROM history_transfers WHERE updated_at < now() - interval '2 days'`);
    return result.rowCount ?? 0;
  }
}
