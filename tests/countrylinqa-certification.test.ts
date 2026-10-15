import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertPeoplePage, reasonLabel } from "../clients/mobile/services/countrylinqa.contract.ts";

import { checkDedicatedDatabase } from "../scripts/assert-dedicated-test-db.mjs";

const script = path.resolve(import.meta.dirname, "../scripts/countrylinqa-certification.mjs");
const PASS_FIELDS = ["androidPhysical", "myCountry", "selectedCountries", "region", "worldwide", "inboundPrivacy", "pauseDiscovery", "block", "advancedFilters", "savedSearch", "pagination", "cacheInvalidation", "restrictedUser", "redisUnavailable", "accountSwitch"];

function run(manifest: object, evidence: object) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clq-cert-"));
  fs.writeFileSync(path.join(dir, "m.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "e.json"), JSON.stringify(evidence));
  const result = spawnSync(process.execPath, [script, "verify", path.join(dir, "m.json"), path.join(dir, "e.json")], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

const manifest = { gitSha: "abc", server: { sha256: "s1" }, android: { sha256: "a1" }, ios: null };
const evidence = () => ({
  gitSha: "abc", serverSha256: "s1", androidSha256: "a1", deviceA: "Pixel", deviceB: "Galaxy", countryA: "US", countryB: "GH",
  ...Object.fromEntries(PASS_FIELDS.map((field) => [field, "PASS"]))
});

test("certification passes only with matching SHA and digests and every scenario PASS", () => {
  assert.equal(run(manifest, evidence()).code, 0);
  assert.match(run(manifest, { ...evidence(), gitSha: "other" }).out, /GIT_SHA_MISMATCH/);
  assert.match(run(manifest, { ...evidence(), countryB: "US" }).out, /TWO_DISTINCT_COUNTRIES_REQUIRED/);
  assert.match(run(manifest, { ...evidence(), serverSha256: "x" }).out, /SERVER_DIGEST_MISMATCH/);
  assert.match(run(manifest, { ...evidence(), androidSha256: "x" }).out, /ANDROID_DIGEST_MISMATCH/);
  assert.match(run(manifest, { ...evidence(), block: "PENDING" }).out, /CERTIFICATION_NOT_PASS:block/);
  const missing = evidence() as Record<string, unknown>; delete missing.deviceB;
  assert.match(run(manifest, missing).out, /MISSING_CERTIFICATION_FIELD:deviceB/);
});

test("iOS must be certified when required", () => {
  assert.match(run(manifest, { ...evidence(), iosRequired: true }).out, /IOS_ARTIFACT_REQUIRED/);
  const withIos = { ...manifest, ios: { sha256: "i1" } };
  assert.match(run(withIos, { ...evidence(), iosRequired: true, iosSha256: "i1", iosPhysical: "PENDING" }).out, /IOS_PHYSICAL_CERTIFICATION_REQUIRED/);
  assert.equal(run(withIos, { ...evidence(), iosRequired: true, iosSha256: "i1", iosPhysical: "PASS" }).code, 0);
});

test("the mobile contract rejects malformed people responses and maps reasons to copy", () => {
  const person = { id: "u1", displayName: "Ama", avatarObjectKey: null, verifiedCountryCode: "GH", verified: true, rankingScore: 0.5, reasons: ["SHARED_LANGUAGE"], connectionStatus: null };
  assert.equal(assertPeoplePage({ items: [person], nextCursor: null, meta: { policyVersion: 2 } }).items.length, 1);
  assert.throws(() => assertPeoplePage({ items: [{ id: "u1" }] }), /INVALID_COUNTRYLINQA_PERSON_CONTRACT/);
  assert.throws(() => assertPeoplePage({}), /INVALID_COUNTRYLINQA_PEOPLE_CONTRACT/);
  assert.equal(reasonLabel("SHARED_LANGUAGE"), "Speaks your language");
  assert.equal(reasonLabel("SOMETHING_NEW"), "Suggested for you");
});

test("the dedicated database guard accepts throwaway databases and refuses anything else", () => {
  const check = (url: string | undefined, env: Record<string, string> = {}) => checkDedicatedDatabase(url, env);
  assert.equal(check("postgresql://u:p@127.0.0.1:5432/linqa_test").ok, true);
  assert.equal(check("postgresql://u:p@db/countrylinqa_ci_test").ok, true);
  assert.equal(check("postgresql://u:p@db/ci").ok, true);
  assert.equal(check("postgresql://u:p@127.0.0.1:5432/linqa").code, 4);
  assert.equal(check("postgresql://u:p@db/production").code, 4);
  assert.equal(check("postgresql://u:p@db/prod_test").code, 4);
  assert.equal(check("postgresql://u:p@db/staging").code, 3);
  assert.equal(check("postgresql://u:p@db/latest").code, 3); // "test" inside a word is not a test database
  // An empty value means "missing". Passing undefined would fall back to the real DATABASE_URL (set in CI) via the default parameter.
  assert.equal(check("").code, 2);
  assert.equal(check("not a url").code, 2);
  assert.equal(check("postgresql://u:p@db/staging", { LINQA_ALLOW_CERT_DB: "1" }).ok, true);
});
