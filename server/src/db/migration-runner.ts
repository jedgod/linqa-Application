import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
const checksum = (sql: string) => createHash("sha256").update(sql, "utf8").digest("hex");

export async function migrate(db: SqlClient, directory: string, applicationVersion: string): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum_sha256 VARCHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    execution_ms INTEGER NOT NULL DEFAULT 0,
    application_version VARCHAR(100),
    dirty BOOLEAN NOT NULL DEFAULT false
  )`);
  await db.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS execution_ms INTEGER NOT NULL DEFAULT 0");
  await db.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS application_version VARCHAR(100)");
  await db.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS dirty BOOLEAN NOT NULL DEFAULT false");
  await db.query("SELECT pg_advisory_lock(hashtext('linqa-schema-migrations'))");
  try {
    const files = (await readdir(directory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
    for (const file of files) {
      const originalSql = await readFile(join(directory, file), "utf8");
      const sum = checksum(originalSql);
      const existing = await db.query(
        "SELECT checksum_sha256, dirty FROM schema_migrations WHERE version = $1",
        [file]
      );
      if (existing.rows[0]) {
        if (existing.rows[0].dirty) throw new Error(`Dirty migration: ${file}`);
        if (existing.rows[0].checksum_sha256 !== sum) throw new Error(`Migration checksum mismatch: ${file}`);
        continue;
      }

      await db.query(
        `INSERT INTO schema_migrations(version, checksum_sha256, execution_ms, application_version, dirty)
         VALUES($1,$2,0,$3,true)`,
        [file, sum, applicationVersion]
      );
      const startedAt = Date.now();
      const transactionalSql = originalSql
        .replace(/^\s*BEGIN\s*;\s*/i, "")
        .replace(/\s*COMMIT\s*;\s*$/i, "");
      await db.query("BEGIN");
      try {
        await db.query(transactionalSql);
        await db.query(
          `UPDATE schema_migrations
           SET dirty=false, execution_ms=$2, applied_at=now(), application_version=$3
           WHERE version=$1`,
          [file, Date.now() - startedAt, applicationVersion]
        );
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await db.query("SELECT pg_advisory_unlock(hashtext('linqa-schema-migrations'))");
  }
}
