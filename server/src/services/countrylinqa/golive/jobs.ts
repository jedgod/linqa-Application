import type { Database } from "../../../db/pool.js";
import { aggregateDailyMetrics } from "./analytics.js";

async function runJob(db: Database, name: string, fn: () => Promise<void>): Promise<void> {
  const inserted = await db.query(
    `INSERT INTO countrylinqa_job_runs (job_name, status) VALUES ($1, 'STARTED') RETURNING id`,
    [name]
  );
  const id = inserted.rows[0].id;

  try {
    await fn();
    await db.query(
      `UPDATE countrylinqa_job_runs SET status = 'SUCCEEDED', finished_at = now() WHERE id = $1`,
      [id]
    );
  } catch (error) {
    await db.query(
      `UPDATE countrylinqa_job_runs SET status = 'FAILED', finished_at = now(), details = $2 WHERE id = $1`,
      [id, JSON.stringify({ error: error instanceof Error ? error.message : String(error) })]
    );
    throw error;
  }
}

export async function runCountryLinqaDailyJobs(db: Database): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await runJob(db, "countrylinqa.daily_metrics", () => aggregateDailyMetrics(db, today));
}
