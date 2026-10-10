import crypto from "node:crypto";
import type { PoolClient } from "pg";

export interface VaultAuditEvent {
  workspaceId: string;
  actor?: string | undefined;
  type: string;
  subjectType: string;
  subjectId: string;
  requestId?: string | undefined;
  details?: unknown;
}

/** Appends a hash-chained audit row (Vault pack v4.0). Call inside the transaction that made the change. */
export async function appendVaultAudit(client: PoolClient, event: VaultAuditEvent): Promise<string> {
  // Lock the workspace's latest row so two writers cannot chain from the same predecessor.
  const last = await client.query<{ event_hash: string }>(
    "SELECT event_hash FROM vault_audit_events WHERE workspace_id = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE",
    [event.workspaceId]
  );
  const prev = last.rows[0]?.event_hash ?? "";
  const canonical = JSON.stringify({
    workspaceId: event.workspaceId,
    actor: event.actor ?? null,
    type: event.type,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    requestId: event.requestId ?? null,
    details: event.details ?? {},
    prev
  });
  const hash = crypto.createHash("sha256").update(canonical).digest("hex");
  await client.query(
    `INSERT INTO vault_audit_events (workspace_id, actor_user_id, event_type, subject_type, subject_id, request_id, details, prev_hash, event_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [event.workspaceId, event.actor ?? null, event.type, event.subjectType, event.subjectId, event.requestId ?? null, JSON.stringify(event.details ?? {}), prev || null, hash]
  );
  return hash;
}
