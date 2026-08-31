#!/usr/bin/env node
/**
 * Verifies that exact-SHA physical-device evidence exists, passed, and is
 * fresh enough to still describe this build.
 *
 * Decision logic lives in scripts/lib/home-release-policy.mjs so it is unit
 * tested (server/src/tests/home/home-release-gate.test.ts).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { evaluateDeviceEvidence } from "./lib/home-release-policy.mjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const maxAgeHours = Number(process.env.HOME_EVIDENCE_MAX_AGE_HOURS ?? 72);
const required = process.env.HOME_REQUIRE_DEVICE_EVIDENCE !== "false";
const directory = path.resolve("evidence/home");

if (!required) {
  // Surfaced loudly: this is a policy waiver, not a pass.
  console.warn("WARN: HOME_REQUIRE_DEVICE_EVIDENCE=false — device evidence check waived");
  process.exit(0);
}

if (!existsSync(directory)) fail("HOME_EVIDENCE_DIRECTORY_MISSING");

const manifests = readdirSync(directory)
  .filter((name) => name.startsWith(gitSha) && name.endsWith("-manifest.json"))
  .map((name) => {
    const file = path.join(directory, name);
    try {
      return { file: name, manifest: JSON.parse(readFileSync(file, "utf8")) };
    } catch (error) {
      return { file: name, manifest: null, parseError: error instanceof Error ? error.message : "unknown" };
    }
  });

const result = evaluateDeviceEvidence({ gitSha, manifests, maxAgeHours, required });

if (!result.ok) {
  for (const rejection of result.rejected) {
    console.error(`  rejected ${rejection.file}: ${rejection.reason}`);
  }
  fail(result.reason);
}

console.log(
  `PASS: Home device evidence ${result.accepted.file} is exact-SHA and <= ${maxAgeHours}h old`
);
