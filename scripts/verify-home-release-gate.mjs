#!/usr/bin/env node
/**
 * Linqa Home release gate.
 *
 * Runs every blocking check from Home Production Closure Pack v1.0 §25 and
 * Implementation Completion Pack v1.1 §19, prints a per-gate result table, and
 * exits non-zero if anything failed. A passing CI build without matching
 * physical-device evidence is not sufficient for promotion.
 *
 * Device-evidence gates can be waived for a non-promotion run with
 * HOME_REQUIRE_DEVICE_EVIDENCE=false; the waiver is reported as SKIP, never as
 * PASS, so a waived run can never be mistaken for a certified one.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  evaluateDeviceEvidence,
  evaluateProviderRedundancy,
  evaluateReleaseEvidence,
  findFabricatedContent,
  shouldScanFile
} from "./lib/home-release-policy.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const requireDeviceEvidence = process.env.HOME_REQUIRE_DEVICE_EVIDENCE !== "false";
const maxAgeHours = Number(process.env.HOME_EVIDENCE_MAX_AGE_HOURS ?? 72);

function gitOutput(args) {
  return execFileSync("git", args, { encoding: "utf8", cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }).trim();
}

function shell(command, args, cwd = repoRoot) {
  execFileSync(command, args, {
    cwd: path.resolve(repoRoot, cwd),
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32"
  });
}

const gitSha = gitOutput(["rev-parse", "HEAD"]);
const results = [];

function gate(name, fn) {
  try {
    const outcome = fn();
    if (outcome && outcome.skipped) {
      results.push({ name, status: "SKIP", detail: outcome.reason ?? "" });
      console.log(`[SKIP] ${name}${outcome.reason ? ` — ${outcome.reason}` : ""}`);
      return;
    }
    results.push({ name, status: "PASS", detail: "" });
    console.log(`[PASS] ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, status: "FAIL", detail });
    console.error(`[FAIL] ${name} — ${detail}`);
  }
}

gate("clean_git_worktree", () => {
  if (gitOutput(["status", "--porcelain"])) throw new Error("worktree is not clean");
});

gate("server_build", () => {
  shell("npm", ["run", "build"], "server");
});

gate("mobile_typescript", () => {
  shell("npx", ["tsc", "--noEmit"], "clients/mobile");
});

gate("home_targeted_tests", () => {
  // vitest, not jest: this repo's test runner. `--run` forces a single
  // non-watch pass, and the path filter keeps the gate to Home's suite.
  shell("npx", ["vitest", "run", "src/tests/home"], "server");
});

gate("home_migrations_present", () => {
  const migrations = path.join(repoRoot, "server/src/db/migrations");
  const required = ["040_home_production_closure.sql", "041_home_publisher_trust_seed.sql"];
  const present = readdirSync(migrations);
  for (const file of required) {
    if (!present.includes(file)) throw new Error(`missing migration ${file}`);
  }
  // Without a seeded allowlist the validator rejects every article and Home is
  // permanently UNAVAILABLE, so an empty seed is a release blocker.
  const seed = readFileSync(path.join(migrations, "041_home_publisher_trust_seed.sql"), "utf8");
  if (!/INSERT INTO home_news_publishers/i.test(seed)) {
    throw new Error("publisher trust seed contains no publishers");
  }
});

gate("no_fabricated_news_fallbacks", () => {
  const tracked = gitOutput(["ls-files"]).split(/\r?\n/).filter(Boolean);
  const files = [];
  for (const file of tracked) {
    if (!shouldScanFile(file)) continue;
    const absolute = path.join(repoRoot, file);
    if (!existsSync(absolute)) continue;
    files.push({ path: file, text: readFileSync(absolute, "utf8") });
  }
  const findings = findFabricatedContent(files);
  if (findings.length) {
    throw new Error(
      `fabricated news content found: ${findings.map((f) => `${f.path} (${f.marker})`).join(", ")}`
    );
  }
});

gate("news_provider_redundancy", () => {
  const outcome = evaluateProviderRedundancy(process.env);
  if (!outcome.ok) throw new Error(outcome.reason);
});

gate("physical_device_evidence", () => {
  const directory = path.join(repoRoot, "evidence/home");
  if (!requireDeviceEvidence) {
    return { skipped: true, reason: "HOME_REQUIRE_DEVICE_EVIDENCE=false" };
  }
  if (!existsSync(directory)) throw new Error("evidence/home is missing");

  const manifests = readdirSync(directory)
    .filter((name) => name.startsWith(gitSha) && name.endsWith("-manifest.json"))
    .map((name) => {
      try {
        return { file: name, manifest: JSON.parse(readFileSync(path.join(directory, name), "utf8")) };
      } catch {
        return { file: name, manifest: null };
      }
    });

  const outcome = evaluateDeviceEvidence({ gitSha, manifests, maxAgeHours, required: true });
  if (!outcome.ok) {
    const detail = outcome.rejected.map((r) => `${r.file}:${r.reason}`).join(", ");
    throw new Error(detail ? `${outcome.reason} [${detail}]` : outcome.reason);
  }
  return undefined;
});

gate("release_evidence_exact_sha", () => {
  const file = path.join(repoRoot, `evidence/home/${gitSha}-release-evidence.json`);
  if (!requireDeviceEvidence && !existsSync(file)) {
    return { skipped: true, reason: "HOME_REQUIRE_DEVICE_EVIDENCE=false" };
  }
  if (!existsSync(file)) throw new Error(`release evidence missing for exact SHA ${gitSha}`);

  const outcome = evaluateReleaseEvidence({
    gitSha,
    evidence: JSON.parse(readFileSync(file, "utf8"))
  });
  if (!outcome.ok) throw new Error(outcome.reason);
  return undefined;
});

const failures = results.filter((result) => result.status === "FAIL");
const skipped = results.filter((result) => result.status === "SKIP");

console.log("\nHome release gate summary");
for (const result of results) {
  console.log(`  ${result.status.padEnd(4)} ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
}

if (failures.length) {
  console.error(`\nHOME RELEASE BLOCKED. Failed gates: ${failures.map((f) => f.name).join(", ")}`);
  process.exit(1);
}

if (skipped.length) {
  console.warn(
    `\nHOME RELEASE GATE PASSED WITH WAIVERS for ${gitSha}. ` +
      `Skipped: ${skipped.map((s) => s.name).join(", ")}. NOT sufficient for production promotion.`
  );
  process.exit(0);
}

console.log(`\nHOME RELEASE GATE PASSED for ${gitSha}`);
