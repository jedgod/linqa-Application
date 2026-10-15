import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_MILESTONES = ["credential_rotation", "offline_encryption", "integration_tests", "docker_validation", "live_audit"];

/** A file's existence is not evidence of a completed audit. Require signed, current, revision-bound results and verified artifacts. */
export async function runAuditChecklist({ envelope, publicKey, revision, evidenceRoot, now = Date.now() }) {
  if (!publicKey || !/^[a-f0-9]{40,64}$/i.test(revision ?? "")) throw new Error("AUDIT_TRUST_CONFIGURATION_REQUIRED");
  if (createPublicKey(publicKey).asymmetricKeyType !== "ed25519") throw new Error("AUDIT_ED25519_KEY_REQUIRED");
  if (typeof envelope?.payloadBase64 !== "string" || typeof envelope?.signatureBase64 !== "string") throw new Error("AUDIT_ENVELOPE_INVALID");
  const payload = Buffer.from(envelope.payloadBase64, "base64");
  if (!verify(null, payload, publicKey, Buffer.from(envelope.signatureBase64, "base64"))) throw new Error("AUDIT_SIGNATURE_INVALID");
  const document = JSON.parse(payload.toString("utf8"));
  if (document.version !== 1 || document.revision !== revision || !Array.isArray(document.milestones)) throw new Error("AUDIT_REVISION_INVALID");
  const produced = Date.parse(document.producedAt);
  if (!Number.isFinite(produced) || produced > now + 300_000 || now - produced > 30 * 86_400_000) throw new Error("AUDIT_EVIDENCE_EXPIRED");
  const root = await realpath(evidenceRoot);
  for (const id of REQUIRED_MILESTONES) {
    const matches = document.milestones.filter(item => item.id === id);
    if (matches.length !== 1 || matches[0].status !== "PASS" || !Array.isArray(matches[0].artifacts) || !matches[0].artifacts.length) throw new Error(`AUDIT_MILESTONE_UNVERIFIED:${id}`);
    for (const artifact of matches[0].artifacts) {
      if (typeof artifact.path !== "string" || path.isAbsolute(artifact.path) || !/^[a-f0-9]{64}$/i.test(artifact.sha256 ?? "")) throw new Error("AUDIT_ARTIFACT_INVALID");
      const target = await realpath(path.resolve(root, artifact.path));
      const relative = path.relative(root, target);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("AUDIT_ARTIFACT_PATH_ESCAPE");
      const bytes = await readFile(target);
      if (!bytes.length || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256.toLowerCase()) throw new Error("AUDIT_ARTIFACT_HASH_MISMATCH");
    }
  }
  return { status: "PASS", revision, milestones: REQUIRED_MILESTONES };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const file = process.argv[2] ?? "evidence/product-readiness.json";
    const raw = process.env.LINQA_READINESS_ENVELOPE_BASE64 ? Buffer.from(process.env.LINQA_READINESS_ENVELOPE_BASE64, "base64").toString("utf8") : await readFile(file, "utf8");
    const result = await runAuditChecklist({ envelope: JSON.parse(raw), publicKey: process.env.LINQA_READINESS_PUBLIC_KEY_PEM,
      revision: process.env.GITHUB_SHA ?? process.env.GIT_SHA, evidenceRoot: path.dirname(path.resolve(file)) });
    console.log(JSON.stringify(result));
  } catch (error) { console.error("Product readiness audit blocked:", error.message); process.exitCode = 1; }
}
