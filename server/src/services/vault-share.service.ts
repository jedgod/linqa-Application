import crypto from "node:crypto";
import type { Pool } from "pg";
import { ProviderUnavailableError, type CiphertextStore, type Mailer, type SocialCopyAdapter, type StepUpAdapter, type UserDirectory } from "../integrations/vault/production-contracts.js";
import { appendVaultAudit } from "./vault-audit-chain.js";
import { requireObject, requireWorkspace, sharingPolicy, VaultError } from "./vault-access.js";

const sha = (value: string) => crypto.createHash("sha256").update(value).digest();
const unavailable = (error: unknown): never => {
  if (error instanceof ProviderUnavailableError) throw new VaultError(error.code, 503);
  throw error;
};

export interface ShareDeps {
  users: UserDirectory;
  mail: Mailer;
  social: SocialCopyAdapter;
  stepUp: StepUpAdapter;
  ciphertext: CiphertextStore;
  /** Where secure links point, e.g. https://vault.example. Links are refused when this is unset. */
  publicBaseUrl: string | undefined;
}

/**
 * Sharing. Nothing here hands out a storage key or the Vault content key: links carry only an
 * opaque random token (stored as a hash), transfers need the recipient's acceptance, and a social
 * export makes a new copy after a one-use step-up proof.
 */
export class VaultShareService {
  constructor(private readonly db: Pool, private readonly deps: ShareDeps) {}

  async linqaUser(userId: string, input: { workspaceId?: string | undefined; objectId: string; recipient: string }) {
    const recipient = await this.deps.users.resolve(input.recipient);
    if (!recipient || recipient.userId === userId) throw new VaultError("INVALID_RECIPIENT", 400);
    const { workspace } = await requireObject(this.db, userId, input.workspaceId, input.objectId);
    const { rows } = await this.db.query(
      "INSERT INTO vault_share_transfers (workspace_id, object_id, sender_user_id, recipient_user_id, kind) VALUES ($1,$2,$3,$4,'LINQA_USER') RETURNING id, state, created_at",
      [workspace.id, input.objectId, userId, recipient.userId]
    );
    return { transferId: rows[0].id as string, state: rows[0].state as string };
  }

  async vaultToVault(userId: string, input: { workspaceId?: string | undefined; objectId: string; destinationWorkspaceId: string; recipient: string }) {
    const recipient = await this.deps.users.resolve(input.recipient);
    if (!recipient || recipient.userId === userId) throw new VaultError("INVALID_RECIPIENT", 400);
    const { workspace } = await requireObject(this.db, userId, input.workspaceId, input.objectId);
    // The destination must be a workspace the recipient themselves may write to.
    await requireWorkspace(this.db, recipient.userId, input.destinationWorkspaceId, true);
    const { rows } = await this.db.query(
      "INSERT INTO vault_share_transfers (workspace_id, object_id, sender_user_id, recipient_user_id, destination_workspace_id, kind) VALUES ($1,$2,$3,$4,$5,'VAULT_TO_VAULT') RETURNING id, state",
      [workspace.id, input.objectId, userId, recipient.userId, input.destinationWorkspaceId]
    );
    return { transferId: rows[0].id as string, state: rows[0].state as string };
  }

  async incomingTransfers(userId: string) {
    const { rows } = await this.db.query(
      "SELECT id, kind, state, created_at FROM vault_share_transfers WHERE recipient_user_id = $1 AND state = 'PENDING' ORDER BY created_at DESC LIMIT 50",
      [userId]
    );
    return { transfers: rows.map((r) => ({ id: r.id as string, kind: r.kind as string, state: r.state as string, createdAt: new Date(r.created_at).toISOString() })) };
  }

  /** The recipient must accept before anything is theirs. Key wrapping for the recipient happens on the devices. */
  async respondToTransfer(userId: string, transferId: string, accept: boolean) {
    const { rows } = await this.db.query(
      "UPDATE vault_share_transfers SET state = $3, acted_at = now() WHERE id = $1 AND recipient_user_id = $2 AND state = 'PENDING' RETURNING id, state",
      [transferId, userId, accept ? "ACCEPTED" : "REJECTED"]
    );
    if (!rows.length) throw new VaultError("TRANSFER_NOT_FOUND", 404);
    return { transferId, state: rows[0].state as string };
  }

  async revokeTransfer(userId: string, transferId: string) {
    const { rows } = await this.db.query("UPDATE vault_share_transfers SET state = 'REVOKED', acted_at = now() WHERE id = $1 AND sender_user_id = $2 AND state IN ('PENDING','ACCEPTED') RETURNING id", [transferId, userId]);
    if (!rows.length) throw new VaultError("TRANSFER_NOT_FOUND", 404);
    return { transferId, state: "REVOKED" };
  }

  async secureLink(userId: string, input: { workspaceId?: string | undefined; objectId: string; expiresMinutes: number; maxDownloads?: number | undefined; requireAuth?: boolean | undefined; recipientEmail?: string | undefined }) {
    if (!this.deps.publicBaseUrl) throw new VaultError("VAULT_PUBLIC_URL_NOT_CONFIGURED", 503);
    if (!Number.isInteger(input.expiresMinutes) || input.expiresMinutes < 1 || input.expiresMinutes > 10_080) throw new VaultError("INVALID_EXPIRY", 400);
    if (input.maxDownloads !== undefined && (!Number.isInteger(input.maxDownloads) || input.maxDownloads < 1 || input.maxDownloads > 1000)) throw new VaultError("INVALID_DOWNLOAD_LIMIT", 400);
    const { workspace, object } = await requireObject(this.db, userId, input.workspaceId, input.objectId);
    if (object.classification === "PRIVATE") throw new VaultError("PRIVATE_OBJECT_NOT_SHAREABLE_BY_LINK", 403);
    if ((await sharingPolicy(this.db, workspace.id)).externalLinks === "DENY") throw new VaultError("SHARE_POLICY_DENIED", 403);
    const token = crypto.randomBytes(32).toString("base64url");
    const { rows } = await this.db.query(
      `INSERT INTO vault_secure_links (workspace_id, object_id, created_by, token_hash, expires_at, max_downloads, require_auth, recipient_email)
       VALUES ($1,$2,$3,$4, now() + ($5 || ' minutes')::interval, $6, $7, $8) RETURNING id, expires_at`,
      [workspace.id, input.objectId, userId, sha(token), String(input.expiresMinutes), input.maxDownloads ?? null, input.requireAuth ?? true, input.recipientEmail ?? null]
    );
    // The raw token is returned once and never stored.
    return { linkId: rows[0].id as string, expiresAt: new Date(rows[0].expires_at).toISOString(), url: `${this.deps.publicBaseUrl.replace(/\/$/, "")}/vault/share/${token}` };
  }

  async revokeLink(userId: string, linkId: string) {
    const { rows } = await this.db.query(
      `UPDATE vault_secure_links l SET revoked_at = now()
        WHERE l.id = $1 AND l.revoked_at IS NULL
          AND (l.created_by = $2 OR EXISTS (SELECT 1 FROM vault_workspaces w WHERE w.id = l.workspace_id AND w.owner_user_id = $2))
        RETURNING l.id`,
      [linkId, userId]
    );
    if (!rows.length) throw new VaultError("LINK_NOT_FOUND", 404);
    return { linkId, revoked: true };
  }

  /**
   * Opens a link: expiry, revocation, the sign-in requirement and the download limit are all
   * checked and counted in one statement, so two people cannot both take the last download.
   * Returns a short-lived ciphertext URL; the decryption key is never known to the server.
   */
  async resolveLink(token: string, viewerUserId: string | null) {
    const { rows } = await this.db.query(
      `UPDATE vault_secure_links SET download_count = download_count + 1
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
          AND (max_downloads IS NULL OR download_count < max_downloads)
          AND (NOT require_auth OR $2::uuid IS NOT NULL)
        RETURNING id, object_id`,
      [sha(token), viewerUserId]
    );
    if (!rows.length) throw new VaultError("LINK_UNAVAILABLE", 404);
    const object = await this.db.query("SELECT blob_key, size_bytes, encrypted_metadata FROM vault_objects WHERE id = $1 AND state = 'AVAILABLE'", [rows[0].object_id]);
    try {
      if (!object.rowCount) throw new VaultError("LINK_UNAVAILABLE", 404);
      const url = await this.deps.ciphertext.signedGet(object.rows[0].blob_key, 60);
      return { url, sizeBytes: Number(object.rows[0].size_bytes), encryptedMetadata: object.rows[0].encrypted_metadata as unknown, expiresIn: 60 };
    } catch (error) {
      // Nothing was handed out, so the attempt does not count against the limit.
      await this.db.query("UPDATE vault_secure_links SET download_count = GREATEST(0, download_count - 1) WHERE id = $1", [rows[0].id]);
      return unavailable(error);
    }
  }

  async email(userId: string, input: { workspaceId?: string | undefined; objectId: string; email: string; expiresMinutes: number }) {
    if (this.deps.mail.name === "unconfigured") throw new VaultError("MAIL_NOT_CONFIGURED", 503);
    const link = await this.secureLink(userId, { workspaceId: input.workspaceId, objectId: input.objectId, expiresMinutes: input.expiresMinutes, recipientEmail: input.email, requireAuth: false });
    try {
      const sent = await this.deps.mail.sendSecureVaultLink({ to: input.email, url: link.url, expiresAt: link.expiresAt });
      await this.db.query("INSERT INTO vault_email_shares (secure_link_id, recipient_email, state, provider_ref, sent_at) VALUES ($1,$2,'SENT',$3,now())", [link.linkId, input.email, sent.providerRef]);
      return { linkId: link.linkId, state: "SENT" as const };
    } catch (error) {
      // A link nobody received should not stay live.
      await this.db.query("UPDATE vault_secure_links SET revoked_at = now() WHERE id = $1", [link.linkId]);
      await this.db.query("INSERT INTO vault_email_shares (secure_link_id, recipient_email, state) VALUES ($1,$2,'FAILED')", [link.linkId, input.email]);
      return unavailable(error);
    }
  }

  async authorizeSocial(userId: string, deviceId: string, input: { workspaceId?: string | undefined; objectId: string; proof: string; destinationRef?: string | undefined }, requestId?: string) {
    if (this.deps.social.name === "unconfigured") throw new VaultError("SOCIAL_EXPORT_NOT_CONFIGURED", 503);
    const { workspace, object } = await requireObject(this.db, userId, input.workspaceId, input.objectId);
    if ((await sharingPolicy(this.db, workspace.id)).exportSocial === "DENY") throw new VaultError("EXPORT_POLICY_DENIED", 403);
    let proof;
    try {
      proof = await this.deps.stepUp.verifyAndConsume({ userId, deviceId, proof: input.proof, purpose: "VAULT_EXPORT_SOCIAL" });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      throw new VaultError(code === "STEP_UP_NOT_CONFIGURED" ? code : "STEP_UP_REQUIRED", code === "STEP_UP_NOT_CONFIGURED" ? 503 : 401);
    }
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const session = await client.query(
        "INSERT INTO vault_stepup_sessions (workspace_id, user_id, method, assurance_level, expires_at, consumed_at) VALUES ($1,$2,'PASSKEY',2, now() + interval '5 minutes', now()) RETURNING id",
        [workspace.id, userId]
      );
      const grant = await client.query(
        `INSERT INTO vault_export_grants (workspace_id, object_id, requested_by, destination_kind, destination_ref, state, expires_at, stepup_session_id)
         VALUES ($1,$2,$3,'SOCIAL',$4,'AUTHORIZED', now() + interval '5 minutes', $5) RETURNING id, expires_at`,
        [workspace.id, object.id, userId, input.destinationRef ?? null, session.rows[0].id]
      );
      await appendVaultAudit(client, { workspaceId: workspace.id, actor: userId, type: "EXPORT_AUTHORIZED", subjectType: "VAULT_OBJECT", subjectId: object.id, requestId, details: { destination: "SOCIAL", proofJti: proof.jti } });
      await client.query("COMMIT");
      return { grantId: grant.rows[0].id as string, expiresAt: new Date(grant.rows[0].expires_at).toISOString(), note: "A copy will be shared. The original remains private in your vault." };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** One use per grant. The social service receives a ciphertext URL and metadata, never the object id or key. */
  async executeSocial(userId: string, grantId: string, requestId?: string) {
    const client = await this.db.connect();
    let grant;
    try {
      await client.query("BEGIN");
      const found = await client.query("SELECT * FROM vault_export_grants WHERE id = $1 AND requested_by = $2 FOR UPDATE", [grantId, userId]);
      if (!found.rowCount) throw new VaultError("EXPORT_GRANT_NOT_FOUND", 404);
      grant = found.rows[0];
      if (grant.state !== "AUTHORIZED" || new Date(grant.expires_at) <= new Date()) throw new VaultError("EXPORT_GRANT_INVALID", 409);
      await client.query("UPDATE vault_export_grants SET state = 'PENDING' WHERE id = $1", [grantId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const object = await this.db.query("SELECT blob_key, encrypted_metadata, workspace_id FROM vault_objects WHERE id = $1 AND state = 'AVAILABLE'", [grant.object_id]);
    // Social gets a link to a temporary copy under an unrelated key, so it never sees the object's
    // own key or id. The temporary copy is removed as soon as the social side has taken its copy.
    const exportKey = `exports/${crypto.randomUUID()}`;
    let copied = false;
    try {
      if (!object.rowCount) throw new VaultError("VAULT_OBJECT_NOT_FOUND", 404);
      await this.deps.ciphertext.copy(object.rows[0].blob_key, exportKey);
      copied = true;
      const downloadUrl = await this.deps.ciphertext.signedGet(exportKey, 120);
      const out = await this.deps.social.createCopy({ userId, grantId, destinationRef: grant.destination_ref ?? undefined, ciphertextDownloadUrl: downloadUrl, metadata: object.rows[0].encrypted_metadata ?? {} });
      await this.deps.ciphertext.delete(exportKey).catch(() => undefined);
      copied = false;
      const done = await this.db.connect();
      try {
        await done.query("BEGIN");
        await done.query("UPDATE vault_export_grants SET state = 'EXECUTED', executed_at = now() WHERE id = $1 AND state = 'PENDING'", [grantId]);
        await appendVaultAudit(done, { workspaceId: object.rows[0].workspace_id, actor: userId, type: "EXPORT_EXECUTED", subjectType: "VAULT_OBJECT", subjectId: grant.object_id, requestId, details: { destination: "SOCIAL", copy: true } });
        await done.query("COMMIT");
      } catch (error) {
        await done.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        done.release();
      }
      return { state: "EXECUTED" as const, socialObjectId: out.socialObjectId };
    } catch (error) {
      if (copied) await this.deps.ciphertext.delete(exportKey).catch(() => undefined);
      // Nothing was created when a provider is unavailable, so the grant stays usable until it expires.
      if (error instanceof ProviderUnavailableError || error instanceof VaultError) {
        await this.db.query("UPDATE vault_export_grants SET state = 'AUTHORIZED' WHERE id = $1 AND state = 'PENDING'", [grantId]);
      }
      return unavailable(error);
    }
  }
}
