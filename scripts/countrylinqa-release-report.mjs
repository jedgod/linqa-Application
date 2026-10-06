// Writes certification/countrylinqa/release-readiness.json.
//
// Software results come from CI step outcomes passed in as CLQ_* variables
// (set them from the workflow's own step results, not by hand).
// Physical results are NEVER taken from a variable: Android is PASS only when
// the evidence file actually verifies against the build manifest, using the
// authoritative scripts/countrylinqa-certification.mjs.
//
//   COUNTRYLINQA_MANIFEST=countrylinqa-certification-manifest.json \
//   COUNTRYLINQA_EVIDENCE=certification/countrylinqa/evidence.json \
//   node scripts/countrylinqa-release-report.mjs
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();

function physicalAndroid() {
  const manifest = process.env.COUNTRYLINQA_MANIFEST;
  const evidence = process.env.COUNTRYLINQA_EVIDENCE;
  if (!manifest || !evidence || !fs.existsSync(manifest) || !fs.existsSync(evidence)) return "PENDING";
  const result = spawnSync(process.execPath, ["scripts/countrylinqa-certification.mjs", "verify", manifest, evidence], { encoding: "utf8" });
  if (result.status !== 0) return `FAILED:${(result.stderr || "").trim().split("\n").pop()}`;
  // Evidence must describe THIS commit, not an older build.
  return JSON.parse(fs.readFileSync(manifest, "utf8")).gitSha === sha ? "PASS" : "FAILED:MANIFEST_NOT_FOR_HEAD";
}

const report = {
  generatedAt: new Date().toISOString(),
  gitSha: sha,
  cleanWorktree: dirty.length === 0,
  software: {
    serverTests: process.env.CLQ_SERVER_TESTS ?? "UNKNOWN",
    dbIntegration: process.env.CLQ_DB_TESTS ?? "UNKNOWN",
    redisTests: process.env.CLQ_REDIS_TESTS ?? "UNKNOWN",
    mobileTypecheck: process.env.CLQ_MOBILE_TYPECHECK ?? "UNKNOWN",
    workflow: process.env.CLQ_WORKFLOW ?? "NOT_RUN"
  },
  physical: { twoCountryAndroid: physicalAndroid(), ios: "BLOCKED_NO_IOS_PROJECT" }
};

// iOS is blocked until an iOS project exists (certification/countrylinqa/IOS_BLOCKER.md),
// so release readiness is for Android only and the report says so.
report.releaseReady = report.cleanWorktree && Object.values(report.software).every((x) => x === "PASS") && report.physical.twoCountryAndroid === "PASS";
report.scope = "ANDROID_ONLY";

fs.mkdirSync("certification/countrylinqa", { recursive: true });
fs.writeFileSync("certification/countrylinqa/release-readiness.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.releaseReady) process.exitCode = 5;
