#!/usr/bin/env node
/**
 * Records SHA-256 digests for the artifacts of the current Git SHA, so a
 * promoted release can be tied back to the exact bytes that were tested.
 *
 *   LINQA_SERVER_ARTIFACT=... LINQA_ANDROID_APK=... LINQA_IOS_ARTIFACT=... \
 *   node scripts/collect-home-release-evidence.mjs
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const gitSha = run("git", ["rev-parse", "HEAD"]);
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const dirty = run("git", ["status", "--porcelain"]).length > 0;

const targets = {
  serverArtifact: process.env.LINQA_SERVER_ARTIFACT,
  androidApk: process.env.LINQA_ANDROID_APK,
  iosArtifact: process.env.LINQA_IOS_ARTIFACT
};

const evidence = {
  schemaVersion: 1,
  component: "LINQA_HOME",
  gitSha,
  branch,
  worktreeDirty: dirty,
  collectedAt: new Date().toISOString(),
  artifacts: {}
};

for (const [name, file] of Object.entries(targets)) {
  if (!file) continue;
  if (!existsSync(file)) fail(`MISSING_ARTIFACT:${name}:${file}`);
  const stats = statSync(file);
  if (!stats.isFile() || stats.size === 0) fail(`EMPTY_ARTIFACT:${name}:${file}`);
  evidence.artifacts[name] = {
    path: path.resolve(file),
    bytes: stats.size,
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex")
  };
}

// Evidence with no digests cannot bind a promotion to a build, so refuse to
// write a manifest that would pass the gate while proving nothing.
if (Object.keys(evidence.artifacts).length === 0) {
  fail(
    "NO_ARTIFACTS_CONFIGURED: set at least one of " +
      "LINQA_SERVER_ARTIFACT, LINQA_ANDROID_APK, LINQA_IOS_ARTIFACT"
  );
}

mkdirSync("evidence/home", { recursive: true });
const out = `evidence/home/${gitSha}-release-evidence.json`;
writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(out);
