import test from "node:test";
import assert from "node:assert/strict";
import { checkDependencyExceptions, checkUpstream } from "../scripts/check-dependency-exceptions.mjs";
const advisory = "GHSA-vfj7-8cjw-p6xm";
function fixture() { return { today: "2026-10-16", policy: { version: 1, exceptions: [{ advisory, package: "braces", reviewedVersion: "3.0.3", acceptedOn: "2026-10-15", reviewedOn: "2026-10-16", reviewBy: "2027-04-15", scope: "build tooling", rationale: "No published fix", source: `https://github.com/advisories/${advisory}` }] }, auditConfig: { allowlist: [advisory] }, lockfile: { packages: { "node_modules/braces": { version: "3.0.3" } } } }; }
test("dependency exceptions expire on the deadline and cannot silently drift", () => {
  assert.equal(checkDependencyExceptions(fixture()).length, 1);
  assert.throws(() => checkDependencyExceptions({ ...fixture(), today: "2027-04-15" }), /REVIEW_DUE/);
  assert.throws(() => checkDependencyExceptions({ ...fixture(), auditConfig: { allowlist: [] } }), /MISMATCH/);
  assert.throws(() => checkDependencyExceptions({ ...fixture(), lockfile: { packages: { "node_modules/braces": { version: "3.0.4" } } } }), /VERSION_CHANGED/);
  const invalid = fixture(); invalid.policy.exceptions[0].reviewedOn = "2026-02-30";
  assert.throws(() => checkDependencyExceptions(invalid), /METADATA_INVALID/);
});
test("new upstream releases and unavailable registry checks require review", async () => {
  const entries = fixture().policy.exceptions;
  await assert.rejects(checkUpstream(entries, async () => ({ ok: true, json: async () => ({ version: "3.0.4" }) })), /UPSTREAM_REVIEW_REQUIRED/);
  await assert.rejects(checkUpstream(entries, async () => ({ ok: false })), /UPSTREAM_CHECK_FAILED/);
  await checkUpstream(entries, async () => ({ ok: true, json: async () => ({ version: "3.0.3" }) }));
});
