import type { Pool } from "pg";
import { unconfiguredIntakeAdapters, type QuarantineBlobStore } from "./integrations/vault/intake-adapters.js";
import { heartbeat, purgeExpiredQuarantine, reconcileQuota, type Env } from "./services/vault-operations.js";

export interface WorkerLog { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void }

/**
 * Background Vault jobs: purge expired quarantine copies and compare quota with reality, each
 * recording a heartbeat tagged with the running build so release readiness can tell a live worker
 * from a stale one. Off unless VAULT_WORKERS=true, so tests and local runs start nothing.
 */
export function startVaultWorkers(db: Pool, env: Env, log: WorkerLog, blobs: QuarantineBlobStore = unconfiguredIntakeAdapters().blobs): () => void {
  if (env.VAULT_WORKERS !== "true") return () => undefined;
  const sha = env.RELEASE_GIT_SHA ?? "unknown";
  const digest = env.RELEASE_ARTIFACT_DIGEST ?? "unknown";
  const every = (ms: number, worker: string, job: () => Promise<unknown>) => {
    const tick = async () => {
      try { await job(); await heartbeat(db, worker, sha, digest); }
      catch (error) { log.error({ err: error, worker }, "vault worker failed"); }
    };
    void tick();
    const timer = setInterval(() => void tick(), ms);
    timer.unref();
    return timer;
  };
  const timers = [
    every(60_000, "quarantine-purge", () => purgeExpiredQuarantine(db, blobs)),
    every(15 * 60_000, "reconciliation", () => reconcileQuota(db))
  ];
  log.info({ workers: ["quarantine-purge", "reconciliation"] }, "vault workers started");
  return () => timers.forEach(clearInterval);
}
