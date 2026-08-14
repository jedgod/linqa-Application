import { createHash } from "node:crypto";
import type { Database } from "../../../db/pool.js";
import type { CountryLinqaCrypto } from "./crypto.js";

export async function storeSensitiveEvidence(
  db: Database,
  crypto: CountryLinqaCrypto,
  userId: string,
  evidenceType: string,
  payload: unknown,
  ttlDays = 90
): Promise<void> {
  const { version, blob } = crypto.encryptJson(payload);
  const evidenceHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  await db.query(
    `INSERT INTO countrylinqa_sensitive_evidence (user_id, evidence_type, ciphertext, key_version, evidence_hash, expires_at)
     VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' days')::interval)`,
    [userId, evidenceType, blob, version, evidenceHash, ttlDays]
  );
}

export async function loadLatestSensitiveEvidence<T>(
  db: Database,
  crypto: CountryLinqaCrypto,
  userId: string,
  evidenceType: string
): Promise<T | null> {
  const result = await db.query(
    `SELECT ciphertext, key_version FROM countrylinqa_sensitive_evidence
     WHERE user_id = $1 AND evidence_type = $2 AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at DESC LIMIT 1`,
    [userId, evidenceType]
  );
  const row = result.rows[0];
  if (!row) return null;
  return crypto.decryptJson<T>(row.key_version, row.ciphertext);
}
