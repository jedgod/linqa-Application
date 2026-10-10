import type { Pool } from "pg";
import type { QuarantineBlobStore } from "../integrations/vault/intake-adapters.js";

const QUARANTINE_TTL_HOURS = 2;
export const CERTIFIED_PROVIDER_KINDS = ["OBJECT_STORE", "MALWARE", "DLP", "MAIL", "BILLING"] as const;
const WORKER_MAX_AGE_SECONDS = 300;
export const REQUIRED_WORKERS = ["quarantine-purge", "reconciliation"] as const;

/**
 * Deletes quarantine copies nobody confirmed in time, and gives back the space they had reserved.
 * Each row is locked while it is handled, so two workers never act on the same file.
 */
export async function purgeExpiredQuarantine(db: Pool, blobs: QuarantineBlobStore, limit = 100): Promise<number> {
  const client = await db.connect();
  let purged = 0;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, workspace_id, quarantine_key, size_bytes, state FROM vault_intake_requests
        WHERE quarantine_key IS NOT NULL AND state IN ('QUARANTINED','SCANNING','AWAITING_CONFIRMATION','HANDOFF_READY','BLOCKED','FAILED')
          AND updated_at < now() - ($1 || ' hours')::interval
        ORDER BY updated_at LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [String(QUARANTINE_TTL_HOURS), limit]
    );
    for (const row of rows) {
      await blobs.delete(row.quarantine_key);
      // BLOCKED and FAILED imports already gave their reservation back.
      if (["QUARANTINED", "SCANNING", "AWAITING_CONFIRMATION", "HANDOFF_READY"].includes(row.state) && row.size_bytes !== null) {
        await client.query("UPDATE vault_workspaces SET reserved_bytes = GREATEST(0, reserved_bytes - $2), updated_at = now() WHERE id = $1", [row.workspace_id, Number(row.size_bytes)]);
      }
      await client.query("UPDATE vault_intake_requests SET state = 'PURGED', quarantine_key = NULL, updated_at = now() WHERE id = $1", [row.id]);
      purged += 1;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return purged;
}

/** Compares each workspace's stored usage with what its objects actually add up to. Reports; does not rewrite. */
export async function reconcileQuota(db: Pool) {
  const run = await db.query("INSERT INTO vault_reconciliation_runs (kind, state) VALUES ('QUOTA','RUNNING') RETURNING id");
  const diffs = await db.query(
    `WITH actual AS (SELECT workspace_id, COALESCE(sum(size_bytes),0)::bigint AS bytes FROM vault_objects WHERE state = 'AVAILABLE' GROUP BY workspace_id)
     SELECT w.id, w.used_bytes, COALESCE(a.bytes,0) AS actual FROM vault_workspaces w LEFT JOIN actual a ON a.workspace_id = w.id
      WHERE w.used_bytes <> COALESCE(a.bytes,0)`
  );
  const differences = diffs.rows.map((r) => ({ workspaceId: r.id as string, recorded: Number(r.used_bytes), actual: Number(r.actual) }));
  await db.query("UPDATE vault_reconciliation_runs SET state = 'DONE', completed_at = now(), summary = $2 WHERE id = $1", [run.rows[0].id, JSON.stringify({ differences })]);
  return differences;
}

export async function heartbeat(db: Pool, worker: string, gitSha: string, artifactDigest: string) {
  await db.query(
    `INSERT INTO vault_worker_heartbeats (worker, git_sha, artifact_digest, heartbeat_at) VALUES ($1,$2,$3,now())
     ON CONFLICT (worker) DO UPDATE SET git_sha = excluded.git_sha, artifact_digest = excluded.artifact_digest, heartbeat_at = now()`,
    [worker, gitSha, artifactDigest]
  );
}

export type Env = Record<string, string | undefined>;

export function vaultFeatureOff(env: Env, feature: "INTAKE" | "SHARING" | "SOCIAL_EXPORT" | "BILLING"): string | null {
  if (env[`VAULT_KILL_${feature}`] === "true") return "VAULT_FEATURE_DISABLED";
  if (env.NODE_ENV === "production" && env.VAULT_PRODUCTION_ENABLED !== "true") return "VAULT_PRODUCTION_DISABLED";
  return null;
}

export interface Readiness {
  ready: boolean;
  reasons: string[];
}

/**
 * Release gate (v7): every item that can be checked by a machine. It is bound to the exact git sha
 * and artifact digest of this build, so approval of a different build does not carry over.
 */
export async function vaultReadiness(db: Pool, env: Env, platformHealthy: () => Promise<boolean>): Promise<Readiness> {
  const reasons: string[] = [];
  if (env.NODE_ENV !== "production") reasons.push("NOT_PRODUCTION_ENVIRONMENT");
  if (env.VAULT_PRODUCTION_ENABLED !== "true") reasons.push("VAULT_PRODUCTION_DISABLED");
  for (const key of ["RELEASE_GIT_SHA", "RELEASE_ARTIFACT_DIGEST", "VAULT_QUARANTINE_BUCKET", "VAULT_CIPHERTEXT_BUCKET"]) {
    if (!env[key]) reasons.push(`VAULT_ENV_MISSING:${key}`);
  }
  if (env.VAULT_QUARANTINE_BUCKET && env.VAULT_QUARANTINE_BUCKET === env.VAULT_CIPHERTEXT_BUCKET) reasons.push("VAULT_BUCKET_ISOLATION_REQUIRED");

  if (env.RELEASE_GIT_SHA && env.RELEASE_ARTIFACT_DIGEST) {
    const certs = await db.query(
      `SELECT DISTINCT provider_kind FROM vault_provider_certifications
        WHERE status = 'APPROVED' AND environment = 'production' AND git_sha = $1 AND artifact_digest = $2 AND (expires_at IS NULL OR expires_at > now())`,
      [env.RELEASE_GIT_SHA, env.RELEASE_ARTIFACT_DIGEST]
    );
    const have = new Set(certs.rows.map((r) => r.provider_kind as string));
    for (const kind of CERTIFIED_PROVIDER_KINDS) if (!have.has(kind)) reasons.push(`VAULT_PROVIDER_NOT_CERTIFIED:${kind}`);

    const beats = await db.query(
      "SELECT worker FROM vault_worker_heartbeats WHERE git_sha = $1 AND artifact_digest = $2 AND heartbeat_at > now() - ($3 || ' seconds')::interval",
      [env.RELEASE_GIT_SHA, env.RELEASE_ARTIFACT_DIGEST, String(WORKER_MAX_AGE_SECONDS)]
    );
    const alive = new Set(beats.rows.map((r) => r.worker as string));
    for (const worker of REQUIRED_WORKERS) if (!alive.has(worker)) reasons.push(`VAULT_WORKER_STALE:${worker}`);
  }
  if (!(await platformHealthy().catch(() => false))) reasons.push("VAULT_PLATFORM_UNHEALTHY");
  return { ready: reasons.length === 0, reasons };
}

/** Called at boot only when Vault production is switched on: refuses to start with an unready Vault. */
export async function assertVaultProductionReady(db: Pool, env: Env, platformHealthy: () => Promise<boolean>) {
  if (env.NODE_ENV !== "production" || env.VAULT_PRODUCTION_ENABLED !== "true") return;
  const result = await vaultReadiness(db, env, platformHealthy);
  // Workers start after the server, so a missing heartbeat alone must not block boot.
  const blocking = result.reasons.filter((r) => !r.startsWith("VAULT_WORKER_STALE"));
  if (blocking.length) throw new Error(`VAULT_NOT_READY:${blocking.join(",")}`);
}
