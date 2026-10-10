import crypto from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { unconfiguredProviders, ProviderUnavailableError, type BillingProvider, type CiphertextStore, type PlatformSecurityAdapter, type SocialCopyAdapter, type StepUpAdapter, type UserDirectory } from "../integrations/vault/production-contracts.js";
import { ensureConsumerWorkspace, requireWorkspace } from "../services/vault-access.js";
import { VaultBillingService } from "../services/vault-billing.service.js";
import { VaultFilesService } from "../services/vault-files.service.js";
import { purgeExpiredQuarantine, reconcileQuota, vaultFeatureOff, vaultReadiness } from "../services/vault-operations.js";
import { VaultSecurityCenterService } from "../services/vault-security-center.service.js";
import { VaultShareService } from "../services/vault-share.service.js";

describe("vault feature switches", () => {
  it("turns features off by kill switch and while production is not enabled", () => {
    expect(vaultFeatureOff({ NODE_ENV: "development" }, "SHARING")).toBeNull();
    expect(vaultFeatureOff({ NODE_ENV: "development", VAULT_KILL_SHARING: "true" }, "SHARING")).toBe("VAULT_FEATURE_DISABLED");
    expect(vaultFeatureOff({ NODE_ENV: "production" }, "INTAKE")).toBe("VAULT_PRODUCTION_DISABLED");
    expect(vaultFeatureOff({ NODE_ENV: "production", VAULT_PRODUCTION_ENABLED: "true" }, "INTAKE")).toBeNull();
  });
});

const url = process.env.DATABASE_URL;
const required = process.env.LINQA_REQUIRE_DB_TESTS === "1";
const run = url || required ? describe : describe.skip;

run("vault gap closure against the database", () => {
  const pool = new pg.Pool({ connectionString: url });
  const users: string[] = [];
  const newUser = () => { const id = crypto.randomUUID(); users.push(id); return id; };
  const DEVICE = crypto.randomUUID();

  const platform: PlatformSecurityAdapter = {
    getTwoFactor: async () => ({ enabled: true, methods: ["PASSKEY"] }),
    getTrustedDevices: async () => [{ id: "d1", name: "Phone", platform: "android", trusted: true, lastSeenAt: null }, { id: "d2", name: "Old", platform: "ios", trusted: false, lastSeenAt: null }],
    getLoginAlertPreference: async () => ({ enabled: true }),
    setLoginAlertPreference: async () => undefined,
  };
  const usedProofs = new Set<string>();
  const stepUp: StepUpAdapter = {
    verifyAndConsume: async (i) => {
      if (!i.proof.startsWith("good:") || usedProofs.has(i.proof)) throw new Error("STEP_UP_REPLAYED");
      usedProofs.add(i.proof);
      return { jti: i.proof };
    }
  };
  const directory: UserDirectory = { resolve: async (h) => (h.startsWith("user-") ? { userId: h.slice(5) } : null) };
  const stored = new Map<string, number>();
  const ciphertext: CiphertextStore = {
    name: "memory",
    createUpload: async () => ({ uploadUrl: "memory://up" }),
    signedGet: async (key) => `memory://${key}`,
    head: async (key) => ({ size: stored.get(key) ?? 0 }),
    copy: async (from, to) => { stored.set(to, stored.get(from) ?? 0); },
    delete: async () => undefined
  };
  const copies: Array<Record<string, unknown>> = [];
  const social: SocialCopyAdapter = { name: "memory", createCopy: async (i) => { copies.push({ ...i }); return { socialObjectId: "soc_new_1" }; } };
  const sent: string[] = [];

  function shareService(over: Partial<{ mailFails: boolean; mail: boolean; social: SocialCopyAdapter; ciphertext: CiphertextStore }> = {}) {
    return new VaultShareService(pool, {
      users: directory,
      mail: over.mail === false ? unconfiguredProviders({ stepUp, platform, users: directory }).mail : { name: "memory", sendSecureVaultLink: async (i) => { if (over.mailFails) throw new Error("smtp down"); sent.push(i.url); return { providerRef: "m1" }; } },
      social: over.social ?? social,
      stepUp,
      ciphertext: over.ciphertext ?? ciphertext,
      publicBaseUrl: "https://vault.test"
    });
  }

  async function seedObject(userId: string, over: { classification?: string; folderId?: string | null; tag?: string; createdAt?: string } = {}) {
    const ws = await ensureConsumerWorkspace(pool, userId);
    const id = crypto.randomUUID();
    const key = `vault/${ws.id}/objects/${id}`;
    stored.set(key, 32);
    await pool.query(
      `INSERT INTO vault_objects (id, workspace_id, folder_id, owner_user_id, display_name, media_type, size_bytes, blob_key, classification, state, source_kind, encrypted_metadata, created_at)
       VALUES ($1,$2,$3,$4,NULL,'application/octet-stream',32,$5,$6,'AVAILABLE','SOCIAL','{"n":"ct"}'::jsonb, COALESCE($7::timestamptz, now()))`,
      [id, ws.id, over.folderId ?? null, userId, key, over.classification ?? "NORMAL", over.createdAt ?? null]
    );
    if (over.tag) {
      const t = await pool.query("INSERT INTO vault_tags (workspace_id, name, created_by) VALUES ($1,$2,$3) ON CONFLICT (workspace_id, name) DO UPDATE SET name = excluded.name RETURNING id", [ws.id, over.tag, userId]);
      await pool.query("INSERT INTO vault_object_tags (object_id, tag_id) VALUES ($1,$2)", [id, t.rows[0].id]);
    }
    return { id, workspaceId: ws.id as string, key };
  }

  afterAll(async () => {
    if (users.length) {
      const ws = "(SELECT id FROM vault_workspaces WHERE owner_user_id = ANY($1))";
      await pool.query(`DELETE FROM vault_audit_events WHERE workspace_id IN ${ws}`, [users]);
      await pool.query(`DELETE FROM vault_export_grants WHERE workspace_id IN ${ws}`, [users]);
      await pool.query(`DELETE FROM vault_stepup_sessions WHERE workspace_id IN ${ws}`, [users]);
      await pool.query(`DELETE FROM vault_email_shares WHERE secure_link_id IN (SELECT id FROM vault_secure_links WHERE workspace_id IN ${ws})`, [users]);
      await pool.query(`DELETE FROM vault_share_transfers WHERE workspace_id IN ${ws}`, [users]);
      await pool.query(`DELETE FROM vault_billing_checkouts WHERE user_id = ANY($1)`, [users]);
      await pool.query(`DELETE FROM vault_billing_customers WHERE user_id = ANY($1)`, [users]);
      await pool.query(`DELETE FROM vault_entitlements WHERE user_id = ANY($1)`, [users]);
      await pool.query(`DELETE FROM vault_intake_requests WHERE requested_by = ANY($1)`, [users]);
      await pool.query(`DELETE FROM vault_workspaces WHERE owner_user_id = ANY($1)`, [users]);
      await pool.query(`DELETE FROM vault_billing_events WHERE provider = 'test-billing'`);
    }
    await pool.end();
  });

  describe("workspace access", () => {
    it("denies another user's workspace and blocks writes by viewers", async () => {
      const owner = newUser(); const stranger = newUser(); const viewer = newUser();
      const ws = await ensureConsumerWorkspace(pool, owner);
      await expect(requireWorkspace(pool, stranger, ws.id)).rejects.toMatchObject({ code: "VAULT_FORBIDDEN" });
      await pool.query("INSERT INTO vault_workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'VIEWER')", [ws.id, viewer]);
      await expect(requireWorkspace(pool, viewer, ws.id)).resolves.toBeTruthy();
      await expect(requireWorkspace(pool, viewer, ws.id, true)).rejects.toMatchObject({ code: "VAULT_WRITE_FORBIDDEN" });
    });
  });

  describe("My Files", () => {
    it("lists only the caller's objects, hides PRIVATE ones, filters by tag and pages without losing rows", async () => {
      const user = newUser(); const other = newUser();
      const files = new VaultFilesService(pool);
      const a = await seedObject(user, { tag: "Finance", createdAt: "2026-01-01T00:00:00.000001Z" });
      const b = await seedObject(user, { createdAt: "2026-01-01T00:00:00.000002Z" });
      const c = await seedObject(user, { createdAt: "2026-01-01T00:00:00.000003Z" });
      const hidden = await seedObject(user, { classification: "PRIVATE" });
      await seedObject(other);

      const first = await files.list(user, { limit: 2 });
      expect(first.items.map((i) => i.id)).toEqual(expect.not.arrayContaining([hidden.id]));
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = await files.list(user, { limit: 2, cursor: first.nextCursor! });
      const all = [...first.items, ...second.items].map((i) => i.id);
      expect(new Set(all)).toEqual(new Set([a.id, b.id, c.id]));
      expect(all).toHaveLength(3);
      expect(first.items[0]!.encryptedMetadata).toEqual({ n: "ct" });

      const tagged = await files.list(user, { tag: "Finance" });
      expect(tagged.items.map((i) => i.id)).toEqual([a.id]);
      expect(tagged.items[0]!.tags).toEqual(["Finance"]);

      await expect(files.list(user, { workspaceId: (await ensureConsumerWorkspace(pool, other)).id })).rejects.toMatchObject({ code: "VAULT_FORBIDDEN" });
    });

    it("lists PRIVATE objects only when the caller has proved an unlock", async () => {
      const user = newUser();
      const files = new VaultFilesService(pool);
      const secret = await seedObject(user, { classification: "PRIVATE" });
      expect((await files.list(user, {})).items.map((i) => i.id)).not.toContain(secret.id);
      expect((await files.list(user, { includePrivate: true })).items.map((i) => i.id)).toContain(secret.id);
    });
  });

  describe("sharing", () => {
    it("Linqa-user and vault-to-vault transfers need the recipient to accept", async () => {
      const sender = newUser(); const recipient = newUser(); const stranger = newUser();
      const share = shareService();
      const obj = await seedObject(sender);
      await expect(share.linqaUser(sender, { objectId: obj.id, recipient: `user-${sender}` })).rejects.toMatchObject({ code: "INVALID_RECIPIENT" });
      await expect(share.linqaUser(sender, { objectId: obj.id, recipient: "nobody" })).rejects.toMatchObject({ code: "INVALID_RECIPIENT" });
      await expect(share.linqaUser(stranger, { objectId: obj.id, recipient: `user-${recipient}` })).rejects.toMatchObject({ code: "VAULT_OBJECT_NOT_FOUND" });

      const transfer = await share.linqaUser(sender, { objectId: obj.id, recipient: `user-${recipient}` });
      expect(transfer.state).toBe("PENDING");
      expect((await share.incomingTransfers(recipient)).transfers.map((t) => t.id)).toContain(transfer.transferId);
      await expect(share.respondToTransfer(stranger, transfer.transferId, true)).rejects.toMatchObject({ code: "TRANSFER_NOT_FOUND" });
      expect(await share.respondToTransfer(recipient, transfer.transferId, true)).toMatchObject({ state: "ACCEPTED" });
      await expect(share.respondToTransfer(recipient, transfer.transferId, false)).rejects.toMatchObject({ code: "TRANSFER_NOT_FOUND" });

      const dest = await ensureConsumerWorkspace(pool, recipient);
      const vv = await share.vaultToVault(sender, { objectId: obj.id, destinationWorkspaceId: dest.id, recipient: `user-${recipient}` });
      expect(vv.state).toBe("PENDING");
      const someoneElses = await ensureConsumerWorkspace(pool, stranger);
      await expect(share.vaultToVault(sender, { objectId: obj.id, destinationWorkspaceId: someoneElses.id, recipient: `user-${recipient}` })).rejects.toMatchObject({ code: "VAULT_FORBIDDEN" });
    });

    it("secure links store only a hash, expire, revoke, and take the last download exactly once", async () => {
      const user = newUser();
      const share = shareService();
      const obj = await seedObject(user);
      const link = await share.secureLink(user, { objectId: obj.id, expiresMinutes: 10, maxDownloads: 1, requireAuth: false });
      const token = link.url.split("/").pop()!;
      const row = await pool.query("SELECT token_hash FROM vault_secure_links WHERE id = $1", [link.linkId]);
      expect(row.rows[0].token_hash.toString("hex")).toBe(crypto.createHash("sha256").update(token).digest("hex"));
      expect(JSON.stringify(row.rows[0])).not.toContain(token);

      const results = await Promise.allSettled([share.resolveLink(token, null), share.resolveLink(token, null), share.resolveLink(token, null)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(Number((await pool.query("SELECT download_count FROM vault_secure_links WHERE id = $1", [link.linkId])).rows[0].download_count)).toBe(1);

      const second = await share.secureLink(user, { objectId: obj.id, expiresMinutes: 10 });
      const token2 = second.url.split("/").pop()!;
      await expect(share.resolveLink(token2, null)).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" }); // needs sign-in
      await expect(share.resolveLink(token2, newUser())).resolves.toMatchObject({ expiresIn: 60 });
      await expect(share.revokeLink(newUser(), second.linkId)).rejects.toMatchObject({ code: "LINK_NOT_FOUND" });
      await share.revokeLink(user, second.linkId);
      await expect(share.resolveLink(token2, newUser())).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });

      const third = await share.secureLink(user, { objectId: obj.id, expiresMinutes: 10, requireAuth: false });
      await pool.query("UPDATE vault_secure_links SET expires_at = now() - interval '1 second' WHERE id = $1", [third.linkId]);
      await expect(share.resolveLink(third.url.split("/").pop()!, null)).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
    });

    it("an attempt that hands out nothing does not use up a download", async () => {
      const user = newUser();
      const obj = await seedObject(user);
      const link = await shareService().secureLink(user, { objectId: obj.id, expiresMinutes: 10, maxDownloads: 1, requireAuth: false });
      const offline = shareService({ ciphertext: unconfiguredProviders({ stepUp, platform, users: directory }).ciphertext });
      await expect(offline.resolveLink(link.url.split("/").pop()!, null)).rejects.toMatchObject({ code: "CIPHERTEXT_STORE_NOT_CONFIGURED" });
      expect(Number((await pool.query("SELECT download_count FROM vault_secure_links WHERE id = $1", [link.linkId])).rows[0].download_count)).toBe(0);
    });

    it("links are refused for PRIVATE objects, when business policy denies them, and with a bad expiry", async () => {
      const user = newUser();
      const share = shareService();
      const priv = await seedObject(user, { classification: "PRIVATE" });
      const obj = await seedObject(user);
      await expect(share.secureLink(user, { objectId: obj.id, expiresMinutes: 0 })).rejects.toMatchObject({ code: "INVALID_EXPIRY" });
      await expect(share.secureLink(user, { objectId: priv.id, expiresMinutes: 10 })).rejects.toMatchObject({ code: "PRIVATE_OBJECT_NOT_SHAREABLE_BY_LINK" });
      await pool.query("INSERT INTO vault_policy_profiles (workspace_id, external_links) VALUES ($1,'DENY') ON CONFLICT (workspace_id) DO UPDATE SET external_links = 'DENY'", [obj.workspaceId]);
      await expect(share.secureLink(user, { objectId: obj.id, expiresMinutes: 10 })).rejects.toMatchObject({ code: "SHARE_POLICY_DENIED" });
    });

    it("email sends the secure link, never a storage key, and revokes the link if sending fails", async () => {
      const user = newUser();
      const obj = await seedObject(user);
      const ok = await shareService().email(user, { objectId: obj.id, email: "a@example.com", expiresMinutes: 30 });
      expect(ok.state).toBe("SENT");
      const lastUrl = sent.at(-1)!;
      expect(lastUrl).toMatch(/^https:\/\/vault\.test\/vault\/share\//);
      expect(lastUrl).not.toContain(obj.key);

      await expect(shareService({ mail: false }).email(user, { objectId: obj.id, email: "a@example.com", expiresMinutes: 30 })).rejects.toMatchObject({ code: "MAIL_NOT_CONFIGURED" });
      const before = (await pool.query("SELECT count(*)::int AS n FROM vault_secure_links WHERE workspace_id = $1", [obj.workspaceId])).rows[0].n;
      await expect(shareService({ mailFails: true }).email(user, { objectId: obj.id, email: "a@example.com", expiresMinutes: 30 })).rejects.toThrow("smtp down");
      const live = await pool.query("SELECT count(*)::int AS n FROM vault_secure_links WHERE workspace_id = $1 AND revoked_at IS NULL", [obj.workspaceId]);
      expect(live.rows[0].n).toBe(before); // the new link was revoked, so no extra live link
    });

    it("export to social needs a one-use proof, creates a copy, and the grant works once", async () => {
      const user = newUser();
      const share = shareService();
      const obj = await seedObject(user);
      await expect(share.authorizeSocial(user, DEVICE, { objectId: obj.id, proof: "bad" })).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
      const grant = await share.authorizeSocial(user, DEVICE, { objectId: obj.id, proof: "good:x-1" });
      expect(grant.note).toMatch(/original remains private/i);
      await expect(share.authorizeSocial(user, DEVICE, { objectId: obj.id, proof: "good:x-1" })).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
      await expect(share.executeSocial(newUser(), grant.grantId)).rejects.toMatchObject({ code: "EXPORT_GRANT_NOT_FOUND" });

      const [a, b] = await Promise.allSettled([share.executeSocial(user, grant.grantId), share.executeSocial(user, grant.grantId)]);
      expect([a, b].filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const copy = copies.at(-1)!;
      expect(copy.ciphertextDownloadUrl).toBeTruthy();
      expect(JSON.stringify(copy)).not.toContain(obj.id); // the social side never learns the vault object id
      expect(JSON.stringify(copy)).not.toContain(obj.key);
      expect(copy.ciphertextDownloadUrl).toContain("exports/"); // a temporary copy under an unrelated key
      expect(stored.has(String(copy.ciphertextDownloadUrl).replace("memory://", ""))).toBe(true); // (the fake store keeps it; a real store deletes it)
      expect((await pool.query("SELECT state FROM vault_objects WHERE id = $1", [obj.id])).rows[0].state).toBe("AVAILABLE"); // original untouched
      const events = await pool.query("SELECT event_type FROM vault_audit_events WHERE workspace_id = $1 ORDER BY id", [obj.workspaceId]);
      expect(events.rows.map((r) => r.event_type)).toEqual(["EXPORT_AUTHORIZED", "EXPORT_EXECUTED"]);
    });

    it("export is denied by business policy, fails closed with no social provider, and keeps the grant usable when the provider is down", async () => {
      const user = newUser();
      const obj = await seedObject(user);
      await expect(shareService({ social: unconfiguredProviders({ stepUp, platform, users: directory }).socialCopy }).authorizeSocial(user, DEVICE, { objectId: obj.id, proof: "good:y-0" })).rejects.toMatchObject({ code: "SOCIAL_EXPORT_NOT_CONFIGURED" });

      const down: SocialCopyAdapter = { name: "memory", createCopy: async () => { throw new ProviderUnavailableError("SOCIAL_EXPORT_NOT_CONFIGURED"); } };
      const grant = await shareService({ social: down }).authorizeSocial(user, DEVICE, { objectId: obj.id, proof: "good:y-1" });
      await expect(shareService({ social: down }).executeSocial(user, grant.grantId)).rejects.toMatchObject({ code: "SOCIAL_EXPORT_NOT_CONFIGURED" });
      expect((await pool.query("SELECT state FROM vault_export_grants WHERE id = $1", [grant.grantId])).rows[0].state).toBe("AUTHORIZED");
      await expect(shareService().executeSocial(user, grant.grantId)).resolves.toMatchObject({ state: "EXECUTED" });

      await pool.query("INSERT INTO vault_policy_profiles (workspace_id, export_social) VALUES ($1,'DENY') ON CONFLICT (workspace_id) DO UPDATE SET export_social = 'DENY'", [obj.workspaceId]);
      await expect(shareService().authorizeSocial(user, DEVICE, { objectId: obj.id, proof: "good:y-2" })).rejects.toMatchObject({ code: "EXPORT_POLICY_DENIED" });
    });
  });

  describe("Security Center", () => {
    it("reports what the platform and the providers say, not counters of its own", async () => {
      const user = newUser();
      const center = new VaultSecurityCenterService(pool, platform, () => ({ scanner: false, sharing: true, email: false, socialImport: false, socialExport: true, billing: false }));
      const view = await center.get(user);
      expect(view.encryption).toEqual({ enabled: true, mode: "CLIENT_E2EE" });
      expect(view.twoFactor).toEqual({ enabled: true, methods: ["PASSKEY"] });
      expect(view.trustedDevices.count).toBe(1);
      expect(view.trustedDevices.devices).toHaveLength(2);
      expect(view.scanner.configured).toBe(false);
      expect(view.sharing).toEqual({ configured: true, email: false, socialExport: true });
      expect(await center.setLoginAlerts(user, false)).toEqual({ enabled: false });
    });
  });

  describe("billing", () => {
    const events = new Map<string, { userId?: string; planCode?: string; type: string; sessionRef?: string }>();
    const provider: BillingProvider = {
      name: "test-billing",
      createCheckout: async (i) => ({ sessionRef: `sess_${i.idempotencyKey}`, checkoutUrl: `https://pay.test/${i.idempotencyKey}`, customerRef: `cus_${i.userId}` }),
      verifyWebhook: async (raw, signature) => {
        const expected = crypto.createHash("sha256").update(raw).digest("hex");
        if (signature !== expected) throw new Error("bad signature");
        const body = JSON.parse(raw.toString("utf8")) as { id: string; type: string; userId?: string; planCode?: string; sessionRef?: string };
        events.set(body.id, body);
        return { eventId: body.id, type: body.type, ...(body.userId ? { userId: body.userId } : {}), ...(body.planCode ? { planCode: body.planCode } : {}), ...(body.sessionRef ? { sessionRef: body.sessionRef } : {}) };
      }
    };
    const billing = new VaultBillingService(pool, provider, ["https://app.test"]);
    const sign = (obj: unknown) => { const raw = Buffer.from(JSON.stringify(obj)); return { raw, sig: crypto.createHash("sha256").update(raw).digest("hex") }; };
    const ok = { successUrl: "https://app.test/ok", cancelUrl: "https://app.test/no" };

    it("refuses checkout without a provider, for the free plan, unknown plans and foreign return URLs", async () => {
      const user = newUser();
      const off = new VaultBillingService(pool, unconfiguredProviders({ stepUp, platform, users: directory }).billing, ["https://app.test"]);
      await expect(off.checkout(user, { planCode: "C25", idempotencyKey: "abcdefgh1", ...ok })).rejects.toMatchObject({ code: "BILLING_NOT_CONFIGURED" });
      await expect(billing.checkout(user, { planCode: "FREE_5GB", idempotencyKey: "abcdefgh2", ...ok })).rejects.toMatchObject({ code: "PLAN_NOT_PURCHASABLE" });
      await expect(billing.checkout(user, { planCode: "NOPE", idempotencyKey: "abcdefgh3", ...ok })).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
      await expect(billing.checkout(user, { planCode: "C25", idempotencyKey: "abcdefgh4", successUrl: "https://evil.test/x", cancelUrl: "https://app.test/no" })).rejects.toMatchObject({ code: "INVALID_RETURN_URL" });
      await expect(billing.checkout(user, { planCode: "C25", idempotencyKey: "abcdefgh5", successUrl: "http://app.test/x", cancelUrl: "https://app.test/no" })).rejects.toMatchObject({ code: "INVALID_RETURN_URL" });
      await expect(new VaultBillingService(pool, provider, []).checkout(user, { planCode: "C25", idempotencyKey: "abcdefgh6", ...ok })).rejects.toMatchObject({ code: "BILLING_RETURN_URLS_NOT_CONFIGURED" });
    });

    it("checkout is idempotent per user and plan", async () => {
      const user = newUser(); const other = newUser();
      const key = `idem-${crypto.randomUUID()}`;
      const one = await billing.checkout(user, { planCode: "C25", idempotencyKey: key, ...ok });
      const two = await billing.checkout(user, { planCode: "C25", idempotencyKey: key, ...ok });
      expect(two).toEqual(one);
      await expect(billing.checkout(user, { planCode: "C40", idempotencyKey: key, ...ok })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
      await expect(billing.checkout(other, { planCode: "C25", idempotencyKey: key, ...ok })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    });

    it("applies a verified webhook once, from the server's plan catalog, and ignores client-supplied sizes", async () => {
      const user = newUser();
      await ensureConsumerWorkspace(pool, user);
      const event = { id: `evt_${crypto.randomUUID()}`, type: "subscription.active", userId: user, planCode: "C25", quotaBytes: 1, priceMinor: 1 };
      const { raw, sig } = sign(event);
      expect(await billing.webhook(raw, sig)).toEqual({ processed: true });
      const ws = await ensureConsumerWorkspace(pool, user);
      const catalog = await pool.query("SELECT quota_bytes FROM vault_plans WHERE code = 'C25'");
      expect(ws.plan_code).toBe("C25");
      expect(Number(ws.quota_bytes)).toBe(Number(catalog.rows[0].quota_bytes));
      expect((await pool.query("SELECT plan_code, status FROM vault_entitlements WHERE user_id = $1", [user])).rows[0]).toEqual({ plan_code: "C25", status: "ACTIVE" });
      expect(await billing.webhook(raw, sig)).toEqual({ duplicate: true }); // replay
    });

    it("rejects a mutated body and records nothing for it", async () => {
      const user = newUser();
      const event = { id: `evt_${crypto.randomUUID()}`, type: "subscription.active", userId: user, planCode: "C25" };
      const { raw, sig } = sign(event);
      const mutated = Buffer.from(raw.toString("utf8").replace("C25", "C1TB"));
      await expect(billing.webhook(mutated, sig)).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_INVALID" });
      expect((await pool.query("SELECT 1 FROM vault_billing_events WHERE provider_event_id = $1", [event.id])).rowCount).toBe(0);
    });

    it("quarantines an event for an unknown plan and downgrades on cancel", async () => {
      const user = newUser();
      await ensureConsumerWorkspace(pool, user);
      const unknown = sign({ id: `evt_${crypto.randomUUID()}`, type: "subscription.active", userId: user, planCode: "GOLD" });
      expect(await billing.webhook(unknown.raw, unknown.sig)).toEqual({ quarantined: true });
      expect((await ensureConsumerWorkspace(pool, user)).plan_code).toBe("FREE_5GB");

      const up = sign({ id: `evt_${crypto.randomUUID()}`, type: "subscription.active", userId: user, planCode: "C40" });
      await billing.webhook(up.raw, up.sig);
      const down = sign({ id: `evt_${crypto.randomUUID()}`, type: "subscription.canceled", userId: user });
      await billing.webhook(down.raw, down.sig);
      expect((await ensureConsumerWorkspace(pool, user)).plan_code).toBe("FREE_5GB");
    });
  });

  describe("operations", () => {
    it("purges expired quarantine copies and returns their reserved space", async () => {
      const user = newUser();
      const ws = await ensureConsumerWorkspace(pool, user);
      await pool.query("UPDATE vault_workspaces SET reserved_bytes = 100 WHERE id = $1", [ws.id]);
      const row = await pool.query(
        `INSERT INTO vault_intake_requests (workspace_id, requested_by, source_kind, source_ref, display_name, state, size_bytes, quarantine_key, updated_at)
         VALUES ($1,$2,'SOCIAL',$3,'f.pdf','AWAITING_CONFIRMATION',100,$4, now() - interval '3 hours') RETURNING id`,
        [ws.id, user, `ref-${crypto.randomUUID()}`, `quarantine/${crypto.randomUUID()}`]
      );
      const deleted: string[] = [];
      const purged = await purgeExpiredQuarantine(pool, { name: "memory", put: async () => ({ sha256: "" }), move: async () => undefined, delete: async (k) => { deleted.push(k); } });
      expect(purged).toBeGreaterThanOrEqual(1);
      expect((await pool.query("SELECT state, quarantine_key FROM vault_intake_requests WHERE id = $1", [row.rows[0].id])).rows[0]).toEqual({ state: "PURGED", quarantine_key: null });
      expect(Number((await ensureConsumerWorkspace(pool, user)).reserved_bytes)).toBe(0);
      expect(deleted.length).toBeGreaterThanOrEqual(1);
    });

    it("reconciliation reports workspaces whose recorded usage differs from their objects", async () => {
      const user = newUser();
      const obj = await seedObject(user);
      await pool.query("UPDATE vault_workspaces SET used_bytes = 999 WHERE id = $1", [obj.workspaceId]);
      const diffs = await reconcileQuota(pool);
      expect(diffs).toEqual(expect.arrayContaining([{ workspaceId: obj.workspaceId, recorded: 999, actual: 32 }]));
    });

    it("readiness explains what is missing and is bound to the exact build", async () => {
      const dev = await vaultReadiness(pool, { NODE_ENV: "development" }, async () => true);
      expect(dev.ready).toBe(false);
      expect(dev.reasons).toEqual(expect.arrayContaining(["NOT_PRODUCTION_ENVIRONMENT", "VAULT_PRODUCTION_DISABLED"]));

      const sha = `sha-${crypto.randomUUID()}`; const digest = `dig-${crypto.randomUUID()}`;
      const base = { NODE_ENV: "production", VAULT_PRODUCTION_ENABLED: "true", RELEASE_GIT_SHA: sha, RELEASE_ARTIFACT_DIGEST: digest, VAULT_QUARANTINE_BUCKET: "q", VAULT_CIPHERTEXT_BUCKET: "q" };
      const same = await vaultReadiness(pool, base, async () => true);
      expect(same.reasons).toContain("VAULT_BUCKET_ISOLATION_REQUIRED");
      expect(same.reasons).toContain("VAULT_PROVIDER_NOT_CERTIFIED:MALWARE");
      expect(same.reasons).toContain("VAULT_WORKER_STALE:quarantine-purge");

      const env = { ...base, VAULT_CIPHERTEXT_BUCKET: "c" };
      for (const kind of ["OBJECT_STORE", "MALWARE", "DLP", "MAIL", "BILLING"]) {
        await pool.query("INSERT INTO vault_provider_certifications (provider_kind, provider_name, environment, status, git_sha, artifact_digest, evidence_digest) VALUES ($1,'p','production','APPROVED',$2,$3,'e')", [kind, sha, digest]);
      }
      for (const worker of ["quarantine-purge", "reconciliation"]) {
        await pool.query("INSERT INTO vault_worker_heartbeats (worker, git_sha, artifact_digest) VALUES ($1,$2,$3) ON CONFLICT (worker) DO UPDATE SET git_sha = excluded.git_sha, artifact_digest = excluded.artifact_digest, heartbeat_at = now()", [worker, sha, digest]);
      }
      expect(await vaultReadiness(pool, env, async () => true)).toEqual({ ready: true, reasons: [] });
      expect((await vaultReadiness(pool, env, async () => false)).reasons).toContain("VAULT_PLATFORM_UNHEALTHY");
      expect((await vaultReadiness(pool, { ...env, RELEASE_ARTIFACT_DIGEST: "other-build" }, async () => true)).reasons).toContain("VAULT_PROVIDER_NOT_CERTIFIED:OBJECT_STORE");

      await pool.query("UPDATE vault_worker_heartbeats SET heartbeat_at = now() - interval '10 minutes' WHERE worker = 'reconciliation'");
      expect((await vaultReadiness(pool, env, async () => true)).reasons).toContain("VAULT_WORKER_STALE:reconciliation");
      await pool.query("DELETE FROM vault_provider_certifications WHERE git_sha = $1", [sha]);
      await pool.query("DELETE FROM vault_worker_heartbeats WHERE worker IN ('quarantine-purge','reconciliation')");
    });
  });
});
