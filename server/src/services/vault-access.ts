import type { Pool, PoolClient } from "pg";

export type Queryable = Pick<Pool | PoolClient, "query">;

export class VaultError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

/** The user's own workspace, created on first use. The workspace is never taken from the client. */
export async function ensureConsumerWorkspace(db: Queryable, userId: string) {
  const created = await db.query(
    "INSERT INTO vault_workspaces (owner_user_id, kind, name) VALUES ($1,'CONSUMER','My Vault') ON CONFLICT DO NOTHING RETURNING *",
    [userId]
  );
  if (created.rowCount) return created.rows[0];
  const existing = await db.query("SELECT * FROM vault_workspaces WHERE owner_user_id = $1 AND kind = 'CONSUMER' AND status = 'ACTIVE' LIMIT 1", [userId]);
  if (!existing.rowCount) throw new VaultError("VAULT_WORKSPACE_UNAVAILABLE", 409);
  return existing.rows[0];
}

/**
 * A workspace the user may use: owned by them or one they are an active member of. VIEWERs and
 * AUDITORs can read but never write. With no id, the user's own consumer workspace.
 */
export async function requireWorkspace(db: Queryable, userId: string, workspaceId: string | undefined, write = false) {
  if (!workspaceId) return ensureConsumerWorkspace(db, userId);
  const { rows } = await db.query(
    `SELECT w.*, m.role AS member_role
       FROM vault_workspaces w
       LEFT JOIN vault_workspace_members m ON m.workspace_id = w.id AND m.user_id = $2 AND m.status = 'ACTIVE'
      WHERE w.id = $1 AND w.status = 'ACTIVE' AND (w.owner_user_id = $2 OR m.user_id IS NOT NULL)`,
    [workspaceId, userId]
  );
  if (!rows.length) throw new VaultError("VAULT_FORBIDDEN", 403);
  const workspace = rows[0];
  if (write && workspace.owner_user_id !== userId && (workspace.member_role === "VIEWER" || workspace.member_role === "AUDITOR")) {
    throw new VaultError("VAULT_WRITE_FORBIDDEN", 403);
  }
  return workspace;
}

export async function requireObject(db: Queryable, userId: string, workspaceId: string | undefined, objectId: string, write = false) {
  const workspace = await requireWorkspace(db, userId, workspaceId, write);
  const { rows } = await db.query("SELECT * FROM vault_objects WHERE id = $1 AND workspace_id = $2 AND state = 'AVAILABLE'", [objectId, workspace.id]);
  if (!rows.length) throw new VaultError("VAULT_OBJECT_NOT_FOUND", 404);
  return { workspace, object: rows[0] };
}

/** Business policy that can switch sharing channels off for a workspace. */
export async function sharingPolicy(db: Queryable, workspaceId: string) {
  const { rows } = await db.query("SELECT export_social, external_links FROM vault_policy_profiles WHERE workspace_id = $1", [workspaceId]);
  return { exportSocial: (rows[0]?.export_social as string | undefined) ?? "ALLOW_STEP_UP", externalLinks: (rows[0]?.external_links as string | undefined) ?? "ALLOW_STEP_UP" };
}
