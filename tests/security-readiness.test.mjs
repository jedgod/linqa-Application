import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { REQUIRED_MILESTONES, runAuditChecklist } from "../scripts/security-check.mjs";

test("readiness requires signed, fresh, revision-bound milestone evidence and intact artifacts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linqa-readiness-"));
  try {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const key = publicKey.export({ type: "spki", format: "pem" });
    const revision = "a".repeat(40), now = Date.now();
    await writeFile(path.join(root, "report.txt"), "Executed evidence fixture");
    const artifact = { path: "report.txt", sha256: createHash("sha256").update("Executed evidence fixture").digest("hex") };
    const document = { version: 1, revision, producedAt: new Date(now).toISOString(), milestones: REQUIRED_MILESTONES.map(id => ({ id, status: "PASS", artifacts: [artifact] })) };
    const envelope = doc => { const bytes = Buffer.from(JSON.stringify(doc)); return { payloadBase64: bytes.toString("base64"), signatureBase64: sign(null, bytes, privateKey).toString("base64") }; };
    const check = doc => runAuditChecklist({ envelope: envelope(doc), publicKey: key, revision, evidenceRoot: root, now });
    assert.equal((await check(document)).status, "PASS");
    await assert.rejects(check({ ...document, revision: "b".repeat(40) }), /REVISION_INVALID/);
    await assert.rejects(check({ ...document, producedAt: new Date(now - 31 * 86_400_000).toISOString() }), /EXPIRED/);
    await assert.rejects(check({ ...document, producedAt: new Date(now + 600_000).toISOString() }), /EXPIRED/);
    await assert.rejects(check({ ...document, milestones: [] }), /MILESTONE_UNVERIFIED/);
    await assert.rejects(check({ ...document, milestones: document.milestones.map(m => ({ ...m, status: "UNKNOWN" })) }), /MILESTONE_UNVERIFIED/);
    await assert.rejects(runAuditChecklist({ envelope: { ...envelope(document), signatureBase64: Buffer.alloc(64).toString("base64") }, publicKey: key, revision, evidenceRoot: root, now }), /SIGNATURE_INVALID/);
    await mkdir(path.join(root, "nested"));
    const escape = { ...document, milestones: document.milestones.map(item => ({ ...item, artifacts: [{ ...artifact, path: "../report.txt" }] })) };
    await assert.rejects(runAuditChecklist({ envelope: envelope(escape), publicKey: key, revision, evidenceRoot: path.join(root, "nested"), now }), /PATH_ESCAPE/);
    await writeFile(path.join(root, "report.txt"), "Changed evidence");
    await assert.rejects(check(document), /HASH_MISMATCH/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
