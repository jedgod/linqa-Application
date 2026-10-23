import { createHash } from 'node:crypto';
import type { SqlClient } from '../../db/migration-runner.js';
import { canonical } from '../../security/biometrics/canonical.js';

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
const LEASE_SECONDS = 60;
const RETENTION_HOURS = 24;
const MAX_STORED_BODY_BYTES = 64 * 1024;

export type IdempotencyDecision =
  | { kind: 'execute'; id: string }
  | { kind: 'replay'; code: number; body: unknown }
  | { kind: 'mismatch' }
  | { kind: 'in_progress' };

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(`${method}\n${path}\n${canonical(body ?? {})}`).digest('hex');
}

/**
 * Optional retry guard for the Wallet API. The same (user, key) with the same request replays the stored 2xx response;
 * a different request under that key is refused; a concurrent duplicate waits for the first. Failures and denials are
 * never stored, so a retry after a fix re-executes against the idempotent wallet handlers.
 */
export class WalletIdempotencyService {
  constructor(private readonly db: SqlClient) {}

  async begin(userId: string, key: string, method: string, path: string, hash: string): Promise<IdempotencyDecision> {
    // Opportunistic retention: bounded, so a single request never pays for a large purge.
    await this.db.query(
      `DELETE FROM linqasend_wallet_api_idempotency WHERE id IN (
         SELECT id FROM linqasend_wallet_api_idempotency
         WHERE status='COMPLETED' AND created_at < now() - make_interval(hours => $1) LIMIT 20)`,
      [RETENTION_HOURS]
    );
    const inserted = await this.db.query(
      `INSERT INTO linqasend_wallet_api_idempotency(user_id,idempotency_key,request_method,request_path,request_hash,lease_expires_at)
       VALUES($1,$2,$3,$4,$5,now() + make_interval(secs => $6)) ON CONFLICT (user_id,idempotency_key) DO NOTHING RETURNING id`,
      [userId, key, method, path, hash, LEASE_SECONDS]
    );
    if (inserted.rows[0]) return { kind: 'execute', id: inserted.rows[0].id };

    const row = (await this.db.query(
      `SELECT id,request_hash,status,response_code,response_body,lease_expires_at < now() AS lease_lapsed
       FROM linqasend_wallet_api_idempotency WHERE user_id=$1 AND idempotency_key=$2`,
      [userId, key]
    )).rows[0];
    if (!row) return this.begin(userId, key, method, path, hash); // purged between the two statements
    if (row.request_hash !== hash) return { kind: 'mismatch' };
    if (row.status === 'COMPLETED') return { kind: 'replay', code: row.response_code, body: row.response_body };
    if (!row.lease_lapsed) return { kind: 'in_progress' };
    const taken = await this.db.query(
      `UPDATE linqasend_wallet_api_idempotency SET lease_expires_at = now() + make_interval(secs => $2), updated_at = now()
       WHERE id=$1 AND status='PROCESSING' AND lease_expires_at < now() RETURNING id`,
      [row.id, LEASE_SECONDS]
    );
    return taken.rows[0] ? { kind: 'execute', id: taken.rows[0].id } : { kind: 'in_progress' };
  }

  async complete(id: string, code: number, body: unknown): Promise<void> {
    const serialized = JSON.stringify(body);
    if (code < 200 || code > 299 || serialized === undefined || Buffer.byteLength(serialized) > MAX_STORED_BODY_BYTES) return this.abort(id);
    await this.db.query(
      `UPDATE linqasend_wallet_api_idempotency SET status='COMPLETED', response_code=$2, response_body=$3::jsonb, updated_at=now()
       WHERE id=$1 AND status='PROCESSING'`,
      [id, code, serialized]
    );
  }

  /** Releases the key so a retry executes again. Used for every outcome that is not a stored success. */
  async abort(id: string): Promise<void> {
    await this.db.query(`DELETE FROM linqasend_wallet_api_idempotency WHERE id=$1 AND status='PROCESSING'`, [id]);
  }
}
