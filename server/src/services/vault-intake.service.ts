import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { IntakeUnavailableError, resolverFor, type ImportKind, type IntakeAdapters } from "../integrations/vault/intake-adapters.js";
import { ProviderUnavailableError, unconfiguredProviders, type CiphertextStore, type PlatformSecurityAdapter, type QuarantineReader } from "../integrations/vault/production-contracts.js";
import { appendVaultAudit } from "./vault-audit-chain.js";

export class VaultIntakeError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

export type IntakeState = "RECEIVED" | "FETCHING" | "QUARANTINED" | "SCANNING" | "AWAITING_CONFIRMATION" | "HANDOFF_READY" | "COMPLETED" | "VAULTED" | "BLOCKED" | "FAILED" | "PURGED";
export type CheckState = "done" | "active" | "pending" | "failed";

const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
/** Programs and scripts are never accepted into the vault from social, whatever the scanner says. */
const BLOCKED_EXTENSIONS = new Set(["exe", "msi", "bat", "cmd", "com", "scr", "pif", "vbs", "vbe", "js", "jse", "wsf", "ps1", "apk", "jar", "dll", "sh", "lnk"]);

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}

export function isBlockedFileType(filename: string): boolean {
  return BLOCKED_EXTENSIONS.has(extensionOf(filename));
}

/** A name safe to store and show: no path parts, no control characters, 1 to 255 characters. */
export function cleanDisplayName(input: string): string | null {
  const name = input.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name || name.length > 255 || /[\\/]/.test(name) || name === "." || name === "..") return null;
  return name;
}

export function progressFor(state: IntakeState): number {
  switch (state) {
    case "RECEIVED": return 5;
    case "FETCHING": return 25;
    case "QUARANTINED": return 45;
    case "SCANNING": return 70;
    case "AWAITING_CONFIRMATION":
    case "HANDOFF_READY":
    case "COMPLETED":
    case "VAULTED": return 100;
    default: return 0;
  }
}

export interface IntakeRow {
  state: IntakeState;
  failure_code: string | null;
  sha256: string | null;
  size_bytes: string | number | null;
  verdict: string | null;
  dlp_verdict: string | null;
}

/**
 * The four checks on the Security Scan screen, each reported from what actually ran. A check is
 * "done" only when its evidence exists (a stored hash, a scan result); it is never inferred from
 * progress alone.
 */
export function scanChecks(row: IntakeRow): Array<{ key: string; label: string; state: CheckState }> {
  const stopped = row.state === "BLOCKED" || row.state === "FAILED";
  const fetched = row.sha256 !== null;
  const scanned = row.verdict !== null;
  const typeBlocked = row.failure_code === "FILE_TYPE_BLOCKED";
  const step = (done: boolean, failed: boolean, active: boolean): CheckState => (failed ? "failed" : done ? "done" : active && !stopped ? "active" : "pending");
  return [
    { key: "file_type", label: "Checking file type", state: step(fetched || scanned, typeBlocked, row.state === "FETCHING") },
    { key: "malware", label: "Scanning for malware", state: step(scanned && row.verdict === "CLEAN", scanned && row.verdict !== "CLEAN", row.state === "SCANNING" || row.state === "QUARANTINED") },
    { key: "content", label: "Deep content inspection", state: step(scanned && row.dlp_verdict !== "BLOCK", scanned && row.dlp_verdict === "BLOCK", row.state === "SCANNING") },
    { key: "integrity", label: "Verifying file integrity", state: step(fetched, false, row.state === "FETCHING" || row.state === "QUARANTINED") }
  ];
}

export class VaultIntakeService {
  private readonly ciphertext: CiphertextStore;
  private readonly quarantineReader: QuarantineReader;

  constructor(private readonly db: Pool, private readonly adapters: IntakeAdapters, providers?: { ciphertext?: CiphertextStore; quarantineReader?: QuarantineReader }) {
    const off = unconfiguredProviders({ stepUp: undefined as never, platform: undefined as unknown as PlatformSecurityAdapter, users: undefined as never });
    this.ciphertext = providers?.ciphertext ?? off.ciphertext;
    this.quarantineReader = providers?.quarantineReader ?? off.quarantineReader;
  }

  /** The user's own workspace, created on first use. The workspace is never taken from the client. */
  async ensureConsumerWorkspace(userId: string) {
    const created = await this.db.query(
      "INSERT INTO vault_workspaces (owner_user_id, kind, name) VALUES ($1,'CONSUMER','My Vault') ON CONFLICT DO NOTHING RETURNING *",
      [userId]
    );
    if (created.rowCount) return created.rows[0];
    const existing = await this.db.query("SELECT * FROM vault_workspaces WHERE owner_user_id = $1 AND kind = 'CONSUMER' AND status = 'ACTIVE' LIMIT 1", [userId]);
    if (!existing.rowCount) throw new VaultIntakeError("VAULT_WORKSPACE_UNAVAILABLE", 409);
    return existing.rows[0];
  }

  /** Plans and prices as stored, plus this user's workspace usage. Changing plan needs a billing provider, which is not wired. */
  async listPlans(userId: string) {
    const ws = await this.ensureConsumerWorkspace(userId);
    const { rows } = await this.db.query("SELECT code, quota_bytes, monthly_price_minor, currency FROM vault_plans WHERE active = true AND kind = 'CONSUMER' ORDER BY quota_bytes");
    return {
      billingAvailable: false,
      current: { planCode: ws.plan_code as string, quotaBytes: Number(ws.quota_bytes), usedBytes: Number(ws.used_bytes), reservedBytes: Number(ws.reserved_bytes) },
      plans: rows.map((r) => ({ code: r.code as string, quotaBytes: Number(r.quota_bytes), monthlyPriceMinor: Number(r.monthly_price_minor), currency: String(r.currency).trim() }))
    };
  }

  async listFolders(userId: string) {
    const ws = await this.ensureConsumerWorkspace(userId);
    const { rows } = await this.db.query("SELECT id, parent_id, name FROM vault_folders WHERE workspace_id = $1 ORDER BY lower(name)", [ws.id]);
    const byId = new Map<string, { id: string; parent_id: string | null; name: string }>(rows.map((r) => [r.id, r]));
    return rows.map((r) => {
      const parts = [r.name];
      let parent = r.parent_id ? byId.get(r.parent_id) : undefined;
      for (let depth = 0; parent && depth < 20; depth++) { parts.unshift(parent.name); parent = parent.parent_id ? byId.get(parent.parent_id) : undefined; }
      return { id: r.id as string, parentId: r.parent_id as string | null, name: r.name as string, path: parts.join(" / ") };
    });
  }

  async createFolder(userId: string, input: { name: string; parentId?: string | null | undefined }) {
    const name = cleanDisplayName(input.name);
    if (!name) throw new VaultIntakeError("INVALID_FOLDER_NAME", 400);
    const ws = await this.ensureConsumerWorkspace(userId);
    if (input.parentId) {
      const parent = await this.db.query("SELECT 1 FROM vault_folders WHERE id = $1 AND workspace_id = $2", [input.parentId, ws.id]);
      if (!parent.rowCount) throw new VaultIntakeError("FOLDER_NOT_FOUND", 404);
    }
    try {
      const { rows } = await this.db.query(
        "INSERT INTO vault_folders (workspace_id, parent_id, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id, parent_id, name",
        [ws.id, input.parentId ?? null, name, userId]
      );
      return { id: rows[0].id as string, parentId: rows[0].parent_id as string | null, name: rows[0].name as string };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new VaultIntakeError("FOLDER_EXISTS", 409);
      throw error;
    }
  }

  /**
   * Records the request only; `process` does the fetching and scanning, so a slow scan never blocks
   * the request. The user must say yes to a pre-encryption scan: the server looks at the plaintext
   * in an isolated quarantine to scan it, and nothing else, before the device encrypts it.
   */
  async requestImport(userId: string, input: { kind: ImportKind; sourceRef: string; folderId?: string | null | undefined; plaintextInspectionConsent: boolean }) {
    if (input.plaintextInspectionConsent !== true) throw new VaultIntakeError("PRE_ENCRYPTION_SCAN_CONSENT_REQUIRED", 409);
    const ws = await this.ensureConsumerWorkspace(userId);
    if (input.folderId) {
      const folder = await this.db.query("SELECT 1 FROM vault_folders WHERE id = $1 AND workspace_id = $2", [input.folderId, ws.id]);
      if (!folder.rowCount) throw new VaultIntakeError("FOLDER_NOT_FOUND", 404);
    }
    const { rows } = await this.db.query(
      `INSERT INTO vault_intake_requests (workspace_id, requested_by, source_kind, source_ref, destination_folder_id, display_name)
       VALUES ($1,$2,$3,$4,$5,'pending')
       ON CONFLICT (workspace_id, source_kind, source_ref) DO UPDATE SET updated_at = now()
       RETURNING id, state`,
      [ws.id, userId, input.kind, input.sourceRef, input.folderId ?? null]
    );
    await this.db.query(
      `INSERT INTO vault_intake_sources (intake_id, source_kind, source_metadata, plaintext_inspection_consent)
       SELECT $1,$2,$3,true WHERE NOT EXISTS (SELECT 1 FROM vault_intake_sources WHERE intake_id = $1)`,
      [rows[0].id, input.kind, JSON.stringify({ sourceRef: input.sourceRef })]
    );
    return { importId: rows[0].id as string, state: rows[0].state as IntakeState };
  }

  requestSocialImport(userId: string, input: { sourceAttachmentId: string; folderId?: string | null | undefined; plaintextInspectionConsent: boolean }) {
    return this.requestImport(userId, { kind: "SOCIAL", sourceRef: input.sourceAttachmentId, folderId: input.folderId, plaintextInspectionConsent: input.plaintextInspectionConsent });
  }

  private async settle(id: string, state: IntakeState, failureCode: string | null, release?: { workspaceId: string; bytes: number }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE vault_intake_requests SET state = $2, failure_code = $3, updated_at = now() WHERE id = $1", [id, state, failureCode]);
      if (release && release.bytes > 0) {
        await client.query("UPDATE vault_workspaces SET reserved_bytes = GREATEST(0, reserved_bytes - $2), updated_at = now() WHERE id = $1", [release.workspaceId, release.bytes]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch, check, quarantine and scan one import. It claims the row first, so running it twice
   * for the same import does the work once. It ends in AWAITING_CONFIRMATION only when the file
   * was fetched, passed the type check, was stored, and a configured scanner returned CLEAN.
   */
  async process(importId: string): Promise<IntakeState | null> {
    const claim = await this.db.query("UPDATE vault_intake_requests SET state = 'FETCHING', failure_code = NULL, updated_at = now() WHERE id = $1 AND state IN ('RECEIVED','FAILED') RETURNING *", [importId]);
    if (!claim.rowCount) return null;
    const intake = claim.rows[0];

    let source;
    try {
      source = await resolverFor(this.adapters, intake.source_kind as ImportKind).fetchAuthorizedCopy({ sourceRef: intake.source_ref, requestingUserId: intake.requested_by });
    } catch (error) {
      await this.settle(importId, "FAILED", error instanceof IntakeUnavailableError ? error.code : "SOURCE_UNAVAILABLE");
      return "FAILED";
    }

    const name = cleanDisplayName(source.filename) ?? "file";
    const size = source.bytes.length;
    if (size === 0 || size > MAX_IMPORT_BYTES) {
      await this.settle(importId, "BLOCKED", size === 0 ? "EMPTY_FILE" : "FILE_TOO_LARGE");
      return "BLOCKED";
    }
    if (isBlockedFileType(name)) {
      await this.db.query("UPDATE vault_intake_requests SET display_name = $2, media_type = $3, size_bytes = $4 WHERE id = $1", [importId, name, source.mediaType, size]);
      await this.settle(importId, "BLOCKED", "FILE_TYPE_BLOCKED");
      return "BLOCKED";
    }

    // Reserve space before storing anything, so concurrent imports cannot overfill the workspace.
    const reserved = await this.db.query(
      "UPDATE vault_workspaces SET reserved_bytes = reserved_bytes + $2, updated_at = now() WHERE id = $1 AND used_bytes + reserved_bytes + $2 <= quota_bytes RETURNING id",
      [intake.workspace_id, size]
    );
    if (!reserved.rowCount) {
      await this.settle(importId, "FAILED", "QUOTA_EXCEEDED");
      return "FAILED";
    }
    const release = { workspaceId: intake.workspace_id as string, bytes: size };

    const key = `vault/${intake.workspace_id}/quarantine/intake-${importId}`;
    try {
      const stored = await this.adapters.blobs.put(key, source.bytes, source.mediaType);
      await this.db.query(
        "UPDATE vault_intake_requests SET state = 'QUARANTINED', display_name = $2, media_type = $3, size_bytes = $4, sha256 = $5, quarantine_key = $6, updated_at = now() WHERE id = $1",
        [importId, name, source.mediaType, size, stored.sha256, key]
      );
    } catch (error) {
      await this.settle(importId, "FAILED", error instanceof IntakeUnavailableError ? error.code : "STORAGE_FAILED", release);
      return "FAILED";
    }

    await this.db.query("UPDATE vault_intake_requests SET state = 'SCANNING', updated_at = now() WHERE id = $1", [importId]);
    let verdict;
    try {
      verdict = await this.adapters.scanner.scan({ bytes: source.bytes, filename: name, mediaType: source.mediaType });
    } catch (error) {
      await this.adapters.blobs.delete(key).catch(() => undefined);
      await this.settle(importId, "FAILED", error instanceof IntakeUnavailableError ? error.code : "SCAN_FAILED", release);
      return "FAILED";
    }
    await this.db.query("INSERT INTO vault_scan_results (intake_id, engine, verdict, dlp_verdict, details) VALUES ($1,$2,$3,$4,$5)", [importId, this.adapters.scanner.name, verdict.verdict, verdict.dlp, JSON.stringify(verdict.details ?? {})]);

    if (verdict.verdict !== "CLEAN" || verdict.dlp === "BLOCK") {
      await this.adapters.blobs.delete(key).catch(() => undefined);
      await this.settle(importId, "BLOCKED", verdict.verdict !== "CLEAN" ? "SCAN_BLOCKED" : "DLP_BLOCKED", release);
      return "BLOCKED";
    }
    await this.settle(importId, "AWAITING_CONFIRMATION", null);
    return "AWAITING_CONFIRMATION";
  }

  async getStatus(userId: string, importId: string) {
    const { rows } = await this.db.query(
      `SELECT i.id, i.state, i.display_name, i.size_bytes, i.sha256, i.failure_code, i.media_type, i.destination_folder_id,
              s.verdict, s.dlp_verdict
         FROM vault_intake_requests i
         LEFT JOIN LATERAL (SELECT verdict, dlp_verdict FROM vault_scan_results WHERE intake_id = i.id ORDER BY created_at DESC LIMIT 1) s ON true
        WHERE i.id = $1 AND i.requested_by = $2`,
      [importId, userId]
    );
    if (!rows.length) throw new VaultIntakeError("IMPORT_NOT_FOUND", 404);
    const r = rows[0];
    return {
      importId: r.id as string,
      state: r.state as IntakeState,
      progress: progressFor(r.state),
      filename: r.display_name === "pending" ? null : (r.display_name as string),
      sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
      failureCode: r.failure_code as string | null,
      checks: scanChecks(r)
    };
  }

  private async ownedClean(userId: string, importId: string) {
    const { rows } = await this.db.query("SELECT * FROM vault_intake_requests WHERE id = $1 AND requested_by = $2", [importId, userId]);
    if (!rows.length) throw new VaultIntakeError("IMPORT_NOT_FOUND", 404);
    const intake = rows[0];
    if (intake.state === "COMPLETED") return intake;
    if (intake.state !== "AWAITING_CONFIRMATION" || !intake.quarantine_key || intake.size_bytes === null) throw new VaultIntakeError("IMPORT_NOT_READY", 409);
    return intake;
  }

  /**
   * Hands the clean quarantine copy to the requesting device once. The device must encrypt it with
   * the Vault key it holds and upload the ciphertext; the server never promotes plaintext into the
   * Vault. The grant is short-lived, single-use and bound to the device that asked.
   */
  async handoff(userId: string, deviceId: string, importId: string) {
    const intake = await this.ownedClean(userId, importId);
    if (intake.state === "COMPLETED") throw new VaultIntakeError("IMPORT_ALREADY_COMPLETED", 409);
    let url: string;
    try {
      url = await this.quarantineReader.signedGet(intake.quarantine_key, 300);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw new VaultIntakeError(error.code, 503);
      throw error;
    }
    const token = crypto.randomBytes(32).toString("base64url");
    await this.db.query(
      "INSERT INTO vault_handoff_grants (intake_id, user_id, device_id, token_hash, expires_at) VALUES ($1,$2,$3,$4, now() + interval '5 minutes')",
      [importId, userId, deviceId, crypto.createHash("sha256").update(token).digest()]
    );
    return { importId, state: "HANDOFF_READY" as const, handoffToken: token, url, expiresIn: 300, instruction: "CLIENT_MUST_ENCRYPT_BEFORE_VAULT_UPLOAD" as const };
  }

  /** The server decides where ciphertext goes; the client never supplies a storage key. */
  async createCiphertextUpload(userId: string, importId: string, input: { objectId: string; size: number; mediaType: string }) {
    const intake = await this.ownedClean(userId, importId);
    if (!Number.isSafeInteger(input.size) || input.size <= 0) throw new VaultIntakeError("INVALID_SIZE", 400);
    const storageKey = `vault/${intake.workspace_id}/objects/${input.objectId}`;
    try {
      const target = await this.ciphertext.createUpload({ workspaceId: intake.workspace_id, objectId: input.objectId, storageKey, size: input.size, mediaType: input.mediaType });
      return { objectId: input.objectId, uploadUrl: target.uploadUrl };
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw new VaultIntakeError(error.code, 503);
      throw error;
    }
  }

  /**
   * Records the ciphertext object the device uploaded. It consumes the handoff grant (one use, same
   * device), checks the stored ciphertext's size, charges the quota with the ciphertext size, and
   * deletes the plaintext quarantine copy. Names and tags arrive already encrypted in the metadata.
   */
  async finalizeCiphertext(userId: string, deviceId: string, importId: string, input: { handoffToken: string; objectId: string; ciphertextSize: number; encryptedMetadata: unknown; tags?: string[] | undefined }, requestId?: string) {
    const intake = await this.ownedClean(userId, importId);
    if (intake.state === "COMPLETED") {
      const existing = await this.db.query("SELECT id FROM vault_objects WHERE source_intake_id = $1", [importId]);
      return { importId, state: "COMPLETED" as const, objectId: existing.rows[0]?.id as string };
    }
    const storageKey = `vault/${intake.workspace_id}/objects/${input.objectId}`;
    let head: { size: number };
    try {
      head = await this.ciphertext.head(storageKey);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw new VaultIntakeError(error.code, 503);
      throw new VaultIntakeError("CIPHERTEXT_NOT_FOUND", 409);
    }
    if (head.size !== input.ciphertextSize) throw new VaultIntakeError("CIPHERTEXT_SIZE_MISMATCH", 409);

    const client: PoolClient = await this.db.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query("SELECT * FROM vault_intake_requests WHERE id = $1 AND requested_by = $2 AND state = 'AWAITING_CONFIRMATION' FOR UPDATE", [importId, userId]);
      if (!locked.rowCount) throw new VaultIntakeError("IMPORT_NOT_READY", 409);
      const grant = await client.query(
        `UPDATE vault_handoff_grants SET consumed_at = now()
          WHERE intake_id = $1 AND user_id = $2 AND device_id = $3 AND token_hash = $4 AND consumed_at IS NULL AND expires_at > now()
          RETURNING id`,
        [importId, userId, deviceId, crypto.createHash("sha256").update(input.handoffToken).digest()]
      );
      if (!grant.rowCount) throw new VaultIntakeError("HANDOFF_INVALID", 403);

      const plaintext = Number(locked.rows[0].size_bytes);
      const charged = await client.query(
        `UPDATE vault_workspaces
            SET reserved_bytes = GREATEST(0, reserved_bytes - $2), used_bytes = used_bytes + $3, updated_at = now()
          WHERE id = $1 AND used_bytes + $3 <= quota_bytes
          RETURNING id`,
        [locked.rows[0].workspace_id, plaintext, input.ciphertextSize]
      );
      if (!charged.rowCount) throw new VaultIntakeError("QUOTA_EXCEEDED", 409);

      await client.query(
        `INSERT INTO vault_objects (id, workspace_id, folder_id, owner_user_id, display_name, media_type, size_bytes, sha256, blob_key, classification, state, source_kind, source_ref, encrypted_metadata, source_intake_id, content_encryption)
         VALUES ($1,$2,$3,$4,NULL,'application/octet-stream',$5,NULL,$6,'NORMAL','AVAILABLE',$7,$8,$9,$10,'CLIENT_E2EE')`,
        [input.objectId, locked.rows[0].workspace_id, locked.rows[0].destination_folder_id, userId, input.ciphertextSize, storageKey, locked.rows[0].source_kind === "SCAN_DOCUMENT" ? "SCAN" : locked.rows[0].source_kind, locked.rows[0].source_ref, JSON.stringify(input.encryptedMetadata ?? {}), importId]
      );
      for (const raw of input.tags ?? []) {
        const name = raw.trim().slice(0, 64);
        if (!name) continue;
        const tag = await client.query("INSERT INTO vault_tags (workspace_id, name, created_by) VALUES ($1,$2,$3) ON CONFLICT (workspace_id, name) DO UPDATE SET name = excluded.name RETURNING id", [locked.rows[0].workspace_id, name, userId]);
        await client.query("INSERT INTO vault_object_tags (object_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [input.objectId, tag.rows[0].id]);
      }
      await client.query("UPDATE vault_intake_requests SET state = 'COMPLETED', object_id = $2, updated_at = now() WHERE id = $1", [importId, input.objectId]);
      await appendVaultAudit(client, { workspaceId: locked.rows[0].workspace_id, actor: userId, type: "IMPORT_FINALIZED", subjectType: "VAULT_OBJECT", subjectId: input.objectId, requestId, details: { source: locked.rows[0].source_kind, ciphertextBytes: input.ciphertextSize } });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    // The plaintext copy is no longer needed. A failed delete is picked up by the purge worker.
    await this.adapters.blobs.delete(intake.quarantine_key).catch(() => undefined);
    return { importId, state: "COMPLETED" as const, objectId: input.objectId };
  }
}
