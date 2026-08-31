#!/usr/bin/env node
/**
 * Blocks a Home release that would depend on a single news provider.
 *
 * Decision logic lives in scripts/lib/home-release-policy.mjs so it is unit
 * tested (server/src/tests/home/home-release-gate.test.ts).
 */
import { evaluateProviderRedundancy } from "./lib/home-release-policy.mjs";

const result = evaluateProviderRedundancy(process.env);

if (!result.ok) {
  console.error(result.reason);
  process.exit(1);
}

console.log("PASS: primary and secondary Home news providers configured");
