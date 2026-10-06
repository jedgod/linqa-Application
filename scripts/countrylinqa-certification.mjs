#!/usr/bin/env node
// CountryLinqa release certification: inventory, manifest and verify.
//
//   node scripts/countrylinqa-certification.mjs inventory
//   node scripts/countrylinqa-certification.mjs --software-only   (inventory only; no artifacts or devices needed)
//   node scripts/countrylinqa-certification.mjs manifest        (needs COUNTRYLINQA_SERVER_ARTIFACT, COUNTRYLINQA_ANDROID_APK[, COUNTRYLINQA_IOS_IPA])
//   node scripts/countrylinqa-certification.mjs verify <manifest.json> <evidence.json>
//
// Certification evidence is bound to the exact clean git SHA and the SHA-256 of
// the shipped artifacts. A passing build or test run is not certification:
// the physical two-country scenarios in docs/countrylinqa/ must also be PASS.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const REQUIRED_FILES = [
  "server/src/routes/countrylinqa/routes.ts",
  "server/src/routes/countrylinqa/engine-routes.ts",
  "server/src/services/countrylinqa/discovery.ts",
  "server/src/services/countrylinqa/feed-scope.ts",
  "server/src/services/countrylinqa/service.ts",
  "server/src/services/countrylinqa/engine/people.ts",
  "server/src/services/countrylinqa/engine/eligibility.ts",
  "server/src/services/countrylinqa/engine/cursor.ts",
  "server/src/services/countrylinqa/engine/controls.ts",
  "server/src/services/countrylinqa/engine/jobs.ts",
  "server/src/db/migrations/044_countrylinqa_discovery_engine.sql",
  "server/src/tests/countrylinqa-engine.integration.test.ts",
  "clients/mobile/services/countrylinqa.service.ts",
  "clients/mobile/services/countrylinqa.contract.ts",
  "clients/mobile/app/countrylinqa/world.tsx",
  "clients/mobile/app/countrylinqa/list.tsx",
  "clients/mobile/app/settings/countrylinqa.tsx",
  "clients/mobile/app/onboarding/country-confirmation.tsx",
  "clients/mobile/app/onboarding/country-discovery.tsx",
  "clients/mobile/app/onboarding/complete.tsx",
  "clients/mobile/app/onboarding/resolve.tsx"
];

const EVIDENCE_FIELDS = [
  "gitSha", "serverSha256", "androidSha256", "deviceA", "deviceB", "countryA", "countryB", "androidPhysical",
  "myCountry", "selectedCountries", "region", "worldwide", "inboundPrivacy", "pauseDiscovery", "block",
  "advancedFilters", "savedSearch", "pagination", "cacheInvalidation", "restrictedUser", "redisUnavailable", "accountSwitch"
];
const MUST_PASS = [
  "androidPhysical", "myCountry", "selectedCountries", "region", "worldwide", "inboundPrivacy",
  "pauseDiscovery", "block", "advancedFilters", "savedSearch", "pagination", "cacheInvalidation",
  "restrictedUser", "redisUnavailable", "accountSwitch"
];

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const fail = (code) => { console.error(code); process.exit(1); };

function migrationLevel() {
  const dir = "server/src/db/migrations";
  return Math.max(0, ...fs.readdirSync(dir).map((f) => Number(f.match(/^(\d+)_/)?.[1] ?? 0)));
}

function inventory() {
  const rows = REQUIRED_FILES.map((p) => ({ path: p, exists: fs.existsSync(p), sha256: fs.existsSync(p) ? sha256(p) : null }));
  const missing = rows.filter((r) => !r.exists);
  for (const r of rows) console.log(`${r.exists ? "PASS" : "FAIL"} ${r.path}`);
  console.log(`migration level: ${migrationLevel()}`);
  if (missing.length) fail(`COUNTRYLINQA_INVENTORY_MISSING:${missing.length}`);
}

function manifest() {
  if (git("status", "--porcelain")) fail("CERTIFICATION_REQUIRES_CLEAN_WORKTREE");
  const server = process.env.COUNTRYLINQA_SERVER_ARTIFACT;
  const android = process.env.COUNTRYLINQA_ANDROID_APK;
  const ios = process.env.COUNTRYLINQA_IOS_IPA;
  if (!server || !android) fail("SERVER_ARTIFACT_AND_ANDROID_APK_REQUIRED");
  const out = {
    schemaVersion: 4,
    gitSha: git("rev-parse", "HEAD"),
    generatedAt: new Date().toISOString(),
    migrationLevel: migrationLevel(),
    server: { path: path.basename(server), sha256: sha256(server) },
    android: { path: path.basename(android), sha256: sha256(android) },
    ios: ios ? { path: path.basename(ios), sha256: sha256(ios) } : null,
    certification: { android: "PENDING_PHYSICAL_EXECUTION", ios: ios ? "PENDING_PHYSICAL_EXECUTION" : "NOT_YET_AVAILABLE" }
  };
  fs.writeFileSync("countrylinqa-certification-manifest.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

function verify(manifestPath, evidencePath) {
  if (!manifestPath || !evidencePath) fail("USAGE: verify <manifest.json> <evidence.json>");
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const e = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  for (const k of EVIDENCE_FIELDS) if (e[k] === undefined || e[k] === null || e[k] === "") fail(`MISSING_CERTIFICATION_FIELD:${k}`);
  if (e.countryA === e.countryB) fail("TWO_DISTINCT_COUNTRIES_REQUIRED");
  if (e.gitSha !== m.gitSha) fail("GIT_SHA_MISMATCH");
  if (e.serverSha256 !== m.server.sha256) fail("SERVER_DIGEST_MISMATCH");
  if (e.androidSha256 !== m.android.sha256) fail("ANDROID_DIGEST_MISMATCH");
  for (const k of MUST_PASS) if (e[k] !== "PASS") fail(`CERTIFICATION_NOT_PASS:${k}`);
  if (e.iosRequired === true) {
    if (!m.ios) fail("IOS_ARTIFACT_REQUIRED");
    if (e.iosSha256 !== m.ios.sha256) fail("IOS_DIGEST_MISMATCH");
    if (e.iosPhysical !== "PASS") fail("IOS_PHYSICAL_CERTIFICATION_REQUIRED");
  }
  console.log("COUNTRYLINQA_CERTIFICATION_GATE=PASS");
}

const [command, ...args] = process.argv.slice(2);
if (command === "inventory") inventory();
else if (command === "--software-only") { inventory(); console.log("COUNTRYLINQA_SOFTWARE_INVENTORY=PASS"); }
else if (command === "manifest") manifest();
else if (command === "verify") verify(...args);
else fail("USAGE: countrylinqa-certification.mjs inventory | manifest | verify <manifest> <evidence>");
