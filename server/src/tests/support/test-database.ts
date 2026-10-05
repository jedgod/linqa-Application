import { resolve } from "node:path";
import pg from "pg";
import { migrate } from "../../db/migration-runner.js";

/**
 * Resolves a PostgreSQL for integration tests.
 *
 * Three tiers, in order:
 *
 *  1. `DATABASE_URL` -- a database the developer already has. Fastest, and the
 *     one used when running the suite locally against the dev stack.
 *  2. An explicitly enabled Testcontainers PostgreSQL, migrated from the
 *     repo's own migration directory (`LINQA_TESTCONTAINERS=1`).
 *  3. `null` -- neither is available, and the caller skips.
 *
 * Tier 3 is why every step here is defensive. An integration suite that *fails*
 * on a machine without Docker trains people to ignore red builds; one that
 * skips keeps the signal meaningful. The container path is imported
 * dynamically so that a missing or broken `@testcontainers/postgresql` cannot
 * take down test files that never needed a database.
 */

export interface TestDatabase {
  connectionString: string;
  stop(): Promise<void>;
}

let shared: TestDatabase | null = null;
let attempted = false;

async function startContainer(): Promise<TestDatabase | null> {
  // Docker discovery can block for minutes on desktops where the CLI exists
  // but the engine is stopped. CI already supplies DATABASE_URL; developers
  // who explicitly want the container path can opt in.
  if (process.env.LINQA_TESTCONTAINERS !== "1") return null;
  try {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("linqa_test")
      .withUsername("linqa")
      .withPassword("linqa")
      .start();

    const connectionString = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString, max: 4 });
    try {
      // The same migrations production runs, from the same directory -- a test
      // schema hand-rolled beside them drifts the moment someone adds a column.
      await migrate(pool, resolve("src/db/migrations"), "integration-test");
    } finally {
      await pool.end();
    }

    return {
      connectionString,
      stop: () => container.stop().then(() => undefined)
    };
  } catch (error) {
    // No Docker, no image, an unhealthy engine: all mean "cannot run here".
    const reason = error instanceof Error ? error.message : "unknown";
    console.warn(`[test-database] container unavailable, integration tests will skip: ${reason}`);
    return null;
  }
}

/** Cached so a multi-file run starts at most one container. */
export async function ensureTestDatabase(): Promise<TestDatabase | null> {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, stop: async () => undefined };
  }
  if (attempted) return shared;
  attempted = true;
  shared = await startContainer();
  // CI sets this so a missing database is a red build, not a silently skipped suite.
  if (!shared && process.env.LINQA_REQUIRE_DB_TESTS === "1") {
    throw new Error("LINQA_REQUIRE_DB_TESTS=1 but no test database is available (set DATABASE_URL)");
  }
  return shared;
}
