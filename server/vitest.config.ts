import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // feature-tests import React Native modules and only work with their own native mocks;
    // run them through vitest.chat-features.config.ts (scripts/test-chat-features.ps1).
    exclude: ["**/node_modules/**", "**/dist/**", "feature-tests/**"],
    // Database-backed suites exceed the 5s default on shared CI runners (the dedicated DB runner already uses 30s).
    // Database suites share one PostgreSQL database; with files in parallel the CountryLinqa suites intermittently blocked
    // each other for the full timeout (1 failure in 3 parallel runs, 0 in 3 serial runs on a fresh database).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
