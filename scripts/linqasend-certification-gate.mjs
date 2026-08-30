import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("Usage: node scripts/linqasend-certification-gate.mjs <manifest.json>");
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const exactSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim().toLowerCase();
const requiredCases = ["INTERNAL_DOMESTIC", "INTERNAL_CROSS_BORDER", "EXTERNAL_DOMESTIC", "EXTERNAL_CROSS_BORDER", "BLOCKED_CORRIDOR", "NEW_RECIPIENT_SCAM_WARNING", "ACCOUNT_RECOVERY_COOLDOWN", "WEBHOOK_REPLAY", "REFUND", "REVERSAL", "CHARGEBACK", "PROVIDER_OUTAGE", "RECONCILIATION_BREAK", "SAFEGUARDING_SHORTFALL"];
const failures = [];
if (!/^[a-f0-9]{40}$/.test(manifest.gitSha ?? "")) failures.push("EXACT_GIT_SHA_REQUIRED");
if (String(manifest.gitSha).toLowerCase() !== exactSha) failures.push("MANIFEST_GIT_SHA_MISMATCH");
if (!/^[a-f0-9]{64}$/i.test(manifest.artifactDigest ?? "")) failures.push("ARTIFACT_SHA256_REQUIRED");
if (manifest.mockOnly !== false) failures.push("MOCK_ONLY_CERTIFICATION_FORBIDDEN");
if (manifest.skippedTests !== 0 || manifest.focusedTests !== 0) failures.push("SKIPPED_OR_FOCUSED_TESTS_PRESENT");
if (!Array.isArray(manifest.corridors) || manifest.corridors.length === 0) failures.push("CORRIDOR_CERTIFICATIONS_REQUIRED");
for (const corridor of manifest.corridors ?? []) {
  if (corridor.status !== "CERTIFIED") failures.push(`CORRIDOR_NOT_CERTIFIED:${corridor.id ?? "unknown"}`);
  if (!corridor.expiresAt || new Date(corridor.expiresAt) <= new Date()) failures.push(`CORRIDOR_EVIDENCE_EXPIRED:${corridor.id ?? "unknown"}`);
  const cases = new Set((corridor.physicalTests ?? []).filter((test) => test.passed && !test.mock).map((test) => test.case));
  for (const required of requiredCases) if (!cases.has(required)) failures.push(`PHYSICAL_CASE_MISSING:${corridor.id ?? "unknown"}:${required}`);
  for (const kind of ["MISSING_EXTERNAL", "MISSING_INTERNAL", "AMOUNT_MISMATCH", "DUPLICATE_EXTERNAL", "LATE_EXTERNAL", "WRONG_CURRENCY", "WRONG_PROVIDER_REFERENCE"]) {
    if (!(corridor.failureInjectionTests ?? []).some((test) => test.kind === kind && test.passed && !test.mock)) failures.push(`FAILURE_CASE_MISSING:${corridor.id ?? "unknown"}:${kind}`);
  }
}
if (!manifest.operationsSignoff || !manifest.complianceSignoff) failures.push("REQUIRED_SIGNOFF_MISSING");
if (failures.length) {
  console.error(JSON.stringify({ allowed: false, exactSha, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ allowed: true, exactSha, manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"), corridors: manifest.corridors.length }, null, 2));
