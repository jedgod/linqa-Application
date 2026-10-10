import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IntakeAdapters } from "../integrations/vault/intake-adapters.js";
import { unconfiguredIntakeAdapters } from "../integrations/vault/intake-adapters.js";
import { unconfiguredProviders, type CiphertextStore, type QuarantineReader } from "../integrations/vault/production-contracts.js";
import { VaultIntakeService, cleanDisplayName, isBlockedFileType, progressFor, scanChecks } from "../services/vault-intake.service.js";

describe("vault intake pure helpers", () => {
  it("blocks programs and scripts by extension, case-insensitively", () => {
    expect(isBlockedFileType("setup.EXE")).toBe(true);
    expect(isBlockedFileType("run.ps1")).toBe(true);
    expect(isBlockedFileType("report.pdf")).toBe(false);
    expect(isBlockedFileType("noextension")).toBe(false);
  });

  it("cleans display names and refuses path tricks", () => {
    expect(cleanDisplayName("  Q2 Report.pdf ")).toBe("Q2 Report.pdf");
    expect(cleanDisplayName("../secret")).toBeNull();
    expect(cleanDisplayName("a\\b")).toBeNull();
    expect(cleanDisplayName("bad\u0000name.txt")).toBe("badname.txt");
    expect(cleanDisplayName("   ")).toBeNull();
    expect(cleanDisplayName("x".repeat(256))).toBeNull();
  });

  it("only reports a check done when its evidence exists", () => {
    const pending = scanChecks({ state: "SCANNING", failure_code: null, sha256: null, size_bytes: null, verdict: null, dlp_verdict: null });
    expect(pending.every((c) => c.state !== "done")).toBe(true);
    const clean = scanChecks({ state: "AWAITING_CONFIRMATION", failure_code: null, sha256: "ab", size_bytes: 10, verdict: "CLEAN", dlp_verdict: "CLEAR" });
    expect(clean.every((c) => c.state === "done")).toBe(true);
    const bad = scanChecks({ state: "BLOCKED", failure_code: "SCAN_BLOCKED", sha256: "ab", size_bytes: 10, verdict: "MALWARE", dlp_verdict: "CLEAR" });
    expect(bad.find((c) => c.key === "malware")?.state).toBe("failed");
    expect(progressFor("BLOCKED")).toBe(0);
    expect(progressFor("AWAITING_CONFIRMATION")).toBe(100);
    expect(progressFor("COMPLETED")).toBe(100);
  });
});

const url = process.env.DATABASE_URL;
const required = process.env.LINQA_REQUIRE_DB_TESTS === "1";
const run = url || required ? describe : describe.skip;

run("vault intake against the database", () => {
  const pool = new pg.Pool({ connectionString: url });
  const users: string[] = [];
  const newUser = () => { const id = crypto.randomUUID(); users.push(id); return id; };
  const quarantine = new Map<string, Buffer>();
  const cipher = new Map<string, number>();
  const DEVICE = crypto.randomUUID();

  const ciphertext: CiphertextStore = {
    name: "memory",
    createUpload: async (i) => ({ uploadUrl: `memory://${i.storageKey}` }),
    signedGet: async (key) => `memory://${key}`,
    head: async (key) => { const size = cipher.get(key); if (size === undefined) throw new Error("missing"); return { size }; },
    copy: async (from, to) => { cipher.set(to, cipher.get(from) ?? 0); },
    delete: async (key) => { cipher.delete(key); }
  };
  const reader: QuarantineReader = { signedGet: async (key) => `memory://quarantine/${key}` };

  function adapters(over: Partial<{ file: { bytes: Buffer; filename: string; mediaType: string }; verdict: "CLEAN" | "MALWARE"; dlp: "CLEAR" | "BLOCK" }> = {}): IntakeAdapters {
    const file = over.file ?? { bytes: Buffer.from("hello vault"), filename: "Q2 Financial Report.pdf", mediaType: "application/pdf" };
    const resolver = { name: "test", fetchAuthorizedCopy: async () => file };
    return {
      social: resolver,
      sources: { MESSAGE: resolver },
      scanner: { name: "test-scanner", scan: async () => ({ verdict: over.verdict ?? "CLEAN", dlp: over.dlp ?? "CLEAR" }) },
      blobs: {
        name: "memory",
        put: async (key, bytes) => { quarantine.set(key, bytes); return { sha256: crypto.createHash("sha256").update(bytes).digest("hex") }; },
        move: async (from, to) => { const b = quarantine.get(from); if (!b) throw new Error("missing"); quarantine.set(to, b); quarantine.delete(from); },
        delete: async (key) => { quarantine.delete(key); }
      }
    };
  }
  const service = (a: IntakeAdapters) => new VaultIntakeService(pool, a, { ciphertext, quarantineReader: reader });
  const consent = { plaintextInspectionConsent: true };

  beforeAll(async () => { await pool.query("SELECT 1"); });
  afterAll(async () => {
    if (users.length) {
      await pool.query("DELETE FROM vault_audit_events WHERE workspace_id IN (SELECT id FROM vault_workspaces WHERE owner_user_id = ANY($1))", [users]);
      await pool.query("DELETE FROM vault_intake_requests WHERE requested_by = ANY($1)", [users]);
      await pool.query("DELETE FROM vault_objects WHERE owner_user_id = ANY($1)", [users]);
      await pool.query("DELETE FROM vault_workspaces WHERE owner_user_id = ANY($1)", [users]);
    }
    await pool.end();
  });

  it("creates one consumer workspace per user", async () => {
    const user = newUser();
    const s = new VaultIntakeService(pool, unconfiguredIntakeAdapters());
    const a = await s.ensureConsumerWorkspace(user);
    const b = await s.ensureConsumerWorkspace(user);
    expect(b.id).toBe(a.id);
    expect((await pool.query("SELECT count(*)::int AS n FROM vault_workspaces WHERE owner_user_id = $1", [user])).rows[0].n).toBe(1);
  });

  it("refuses an import unless the user agreed to the pre-encryption scan", async () => {
    const user = newUser();
    const s = service(adapters());
    await expect(s.requestSocialImport(user, { sourceAttachmentId: "a", plaintextInspectionConsent: false })).rejects.toMatchObject({ code: "PRE_ENCRYPTION_SCAN_CONSENT_REQUIRED" });
  });

  it("with nothing configured an import fails closed and reserves nothing", async () => {
    const user = newUser();
    const s = new VaultIntakeService(pool, unconfiguredIntakeAdapters());
    const { importId } = await s.requestSocialImport(user, { sourceAttachmentId: "soc_att_1", ...consent });
    expect(await s.process(importId)).toBe("FAILED");
    const status = await s.getStatus(user, importId);
    expect(status.failureCode).toBe("SOCIAL_SOURCE_NOT_CONFIGURED");
    expect(status.checks.every((c) => c.state !== "done")).toBe(true);
    expect(Number((await s.ensureConsumerWorkspace(user)).reserved_bytes)).toBe(0);
  });

  it("kinds without a resolver fail closed, kinds with one work", async () => {
    const user = newUser();
    const s = service(adapters());
    const client = await s.requestImport(user, { kind: "CLIENT", sourceRef: "c1", ...consent });
    expect(await s.process(client.importId)).toBe("FAILED");
    expect((await s.getStatus(user, client.importId)).failureCode).toBe("SOCIAL_SOURCE_NOT_CONFIGURED");
    const message = await s.requestImport(user, { kind: "MESSAGE", sourceRef: "m1", ...consent });
    expect(await s.process(message.importId)).toBe("AWAITING_CONFIRMATION");
  });

  it("a clean file is handed to the device and enters the Vault only as ciphertext the device uploaded", async () => {
    const user = newUser();
    const s = service(adapters());
    const folder = await s.createFolder(user, { name: "Reports" });
    const { importId } = await s.requestSocialImport(user, { sourceAttachmentId: "soc_att_2", folderId: folder.id, ...consent });
    expect(await s.process(importId)).toBe("AWAITING_CONFIRMATION");

    let ws = await s.ensureConsumerWorkspace(user);
    expect(Number(ws.reserved_bytes)).toBe(11);
    expect(Number(ws.used_bytes)).toBe(0);

    // The deployed "confirm" call now only hands the file over. It must not create a Vault object.
    const handed = await s.handoff(user, DEVICE, importId);
    expect(handed.instruction).toBe("CLIENT_MUST_ENCRYPT_BEFORE_VAULT_UPLOAD");
    expect((await pool.query("SELECT count(*)::int AS n FROM vault_objects WHERE owner_user_id = $1", [user])).rows[0].n).toBe(0);

    const objectId = crypto.randomUUID();
    const upload = await s.createCiphertextUpload(user, importId, { objectId, size: 64, mediaType: "application/octet-stream" });
    expect(upload.uploadUrl).toContain(`/objects/${objectId}`);
    const key = `vault/${ws.id}/objects/${objectId}`;

    // Wrong device, wrong token, and a size that does not match what was stored are all refused.
    cipher.set(key, 64);
    await expect(s.finalizeCiphertext(user, crypto.randomUUID(), importId, { handoffToken: handed.handoffToken, objectId, ciphertextSize: 64, encryptedMetadata: {} })).rejects.toMatchObject({ code: "HANDOFF_INVALID" });
    await expect(s.finalizeCiphertext(user, DEVICE, importId, { handoffToken: "x".repeat(43), objectId, ciphertextSize: 64, encryptedMetadata: {} })).rejects.toMatchObject({ code: "HANDOFF_INVALID" });
    await expect(s.finalizeCiphertext(user, DEVICE, importId, { handoffToken: handed.handoffToken, objectId, ciphertextSize: 99, encryptedMetadata: {} })).rejects.toMatchObject({ code: "CIPHERTEXT_SIZE_MISMATCH" });

    const done = await s.finalizeCiphertext(user, DEVICE, importId, { handoffToken: handed.handoffToken, objectId, ciphertextSize: 64, encryptedMetadata: { name: "ciphertext-name" }, tags: ["Finance", "Q2"] });
    expect(done).toMatchObject({ state: "COMPLETED", objectId });

    ws = await s.ensureConsumerWorkspace(user);
    expect(Number(ws.used_bytes)).toBe(64);
    expect(Number(ws.reserved_bytes)).toBe(0);
    const object = await pool.query("SELECT display_name, folder_id, content_encryption, encrypted_metadata, blob_key FROM vault_objects WHERE id = $1", [objectId]);
    expect(object.rows[0]).toMatchObject({ display_name: null, folder_id: folder.id, content_encryption: "CLIENT_E2EE", blob_key: key });
    expect(object.rows[0].encrypted_metadata).toEqual({ name: "ciphertext-name" });
    const tags = await pool.query("SELECT t.name FROM vault_object_tags ot JOIN vault_tags t ON t.id = ot.tag_id WHERE ot.object_id = $1 ORDER BY t.name", [objectId]);
    expect(tags.rows.map((r) => r.name)).toEqual(["Finance", "Q2"]);
    // The plaintext copy is gone.
    expect([...quarantine.keys()].some((k) => k.includes(importId))).toBe(false);
    expect((await pool.query("SELECT event_type FROM vault_audit_events WHERE workspace_id = $1", [ws.id])).rows.map((r) => r.event_type)).toEqual(["IMPORT_FINALIZED"]);

    // Finalizing again returns the same object and charges nothing more.
    const again = await s.finalizeCiphertext(user, DEVICE, importId, { handoffToken: handed.handoffToken, objectId, ciphertextSize: 64, encryptedMetadata: {} });
    expect(again.objectId).toBe(objectId);
    expect(Number((await s.ensureConsumerWorkspace(user)).used_bytes)).toBe(64);
  });

  it("a handoff grant works once and expires", async () => {
    const user = newUser();
    const s = service(adapters());
    const { importId } = await s.requestSocialImport(user, { sourceAttachmentId: "g1", ...consent });
    await s.process(importId);
    const first = await s.handoff(user, DEVICE, importId);
    await pool.query("UPDATE vault_handoff_grants SET expires_at = now() - interval '1 second' WHERE intake_id = $1", [importId]);
    const objectId = crypto.randomUUID();
    const ws = await s.ensureConsumerWorkspace(user);
    cipher.set(`vault/${ws.id}/objects/${objectId}`, 8);
    await expect(s.finalizeCiphertext(user, DEVICE, importId, { handoffToken: first.handoffToken, objectId, ciphertextSize: 8, encryptedMetadata: {} })).rejects.toMatchObject({ code: "HANDOFF_INVALID" });
    const second = await s.handoff(user, DEVICE, importId);
    await s.finalizeCiphertext(user, DEVICE, importId, { handoffToken: second.handoffToken, objectId, ciphertextSize: 8, encryptedMetadata: {} });
    await expect(s.handoff(user, DEVICE, importId)).rejects.toMatchObject({ code: "IMPORT_ALREADY_COMPLETED" });
  });

  it("handoff and upload fail closed when storage is not configured", async () => {
    const user = newUser();
    const s = new VaultIntakeService(pool, adapters());
    const { importId } = await s.requestSocialImport(user, { sourceAttachmentId: "g2", ...consent });
    await s.process(importId);
    await expect(s.handoff(user, DEVICE, importId)).rejects.toMatchObject({ code: "QUARANTINE_STORE_NOT_CONFIGURED", status: 503 });
    await expect(s.createCiphertextUpload(user, importId, { objectId: crypto.randomUUID(), size: 4, mediaType: "x/y" })).rejects.toMatchObject({ code: "CIPHERTEXT_STORE_NOT_CONFIGURED" });
    void unconfiguredProviders;
  });

  it("malware and DLP blocks release the reservation and never reach handoff", async () => {
    for (const config of [{ verdict: "MALWARE" as const }, { dlp: "BLOCK" as const }]) {
      const user = newUser();
      const s = service(adapters(config));
      const { importId } = await s.requestSocialImport(user, { sourceAttachmentId: "soc_att_3", ...consent });
      expect(await s.process(importId)).toBe("BLOCKED");
      expect((await s.getStatus(user, importId)).failureCode).toBe(config.verdict ? "SCAN_BLOCKED" : "DLP_BLOCKED");
      expect(Number((await s.ensureConsumerWorkspace(user)).reserved_bytes)).toBe(0);
      await expect(s.handoff(user, DEVICE, importId)).rejects.toMatchObject({ code: "IMPORT_NOT_READY" });
    }
  });

  it("an executable is refused before anything is stored", async () => {
    const user = newUser();
    const before = quarantine.size;
    const s = service(adapters({ file: { bytes: Buffer.from("MZ"), filename: "invoice.exe", mediaType: "application/octet-stream" } }));
    const { importId } = await s.requestSocialImport(user, { sourceAttachmentId: "soc_att_4", ...consent });
    expect(await s.process(importId)).toBe("BLOCKED");
    expect((await s.getStatus(user, importId)).failureCode).toBe("FILE_TYPE_BLOCKED");
    expect(quarantine.size).toBe(before);
  });

  it("refuses an import larger than the free quota", async () => {
    const user = newUser();
    const s = service(adapters());
    const ws = await s.ensureConsumerWorkspace(user);
    await pool.query("UPDATE vault_workspaces SET quota_bytes = 5 WHERE id = $1", [ws.id]);
    const { importId } = await s.requestSocialImport(user, { sourceAttachmentId: "soc_att_5", ...consent });
    expect(await s.process(importId)).toBe("FAILED");
    expect((await s.getStatus(user, importId)).failureCode).toBe("QUOTA_EXCEEDED");
  });

  it("one user cannot read or take over another user's import", async () => {
    const owner = newUser();
    const other = newUser();
    const s = service(adapters());
    const { importId } = await s.requestSocialImport(owner, { sourceAttachmentId: "soc_att_6", ...consent });
    await s.process(importId);
    await expect(s.getStatus(other, importId)).rejects.toMatchObject({ code: "IMPORT_NOT_FOUND" });
    await expect(s.handoff(other, DEVICE, importId)).rejects.toMatchObject({ code: "IMPORT_NOT_FOUND" });
  });

  it("processing the same import twice does the work once", async () => {
    const user = newUser();
    const s = service(adapters());
    const { importId } = await s.requestSocialImport(user, { sourceAttachmentId: "soc_att_7", ...consent });
    const [a, b] = await Promise.all([s.process(importId), s.process(importId)]);
    expect([a, b].filter((x) => x === "AWAITING_CONFIRMATION")).toHaveLength(1);
    expect(Number((await s.ensureConsumerWorkspace(user)).reserved_bytes)).toBe(11);
  });

  it("rejects a folder that is not in the user's workspace", async () => {
    const owner = newUser();
    const other = newUser();
    const s = service(adapters());
    const folder = await s.createFolder(owner, { name: "Private" });
    await expect(s.requestSocialImport(other, { sourceAttachmentId: "soc_att_8", folderId: folder.id, ...consent })).rejects.toMatchObject({ code: "FOLDER_NOT_FOUND" });
    await expect(s.createFolder(owner, { name: "private" })).rejects.toMatchObject({ code: "FOLDER_EXISTS" });
  });

  it("lists stored plans with the user's own usage", async () => {
    const user = newUser();
    const result = await service(adapters()).listPlans(user);
    expect(result.billingAvailable).toBe(false);
    expect(result.current).toMatchObject({ planCode: "FREE_5GB", usedBytes: 0, reservedBytes: 0 });
    expect(result.plans.map((p) => p.code)).toEqual(expect.arrayContaining(["FREE_5GB", "C25", "C40", "C60", "C1TB"]));
  });
});
