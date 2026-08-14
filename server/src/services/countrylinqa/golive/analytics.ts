import type { Database } from "../../../db/pool.js";

export async function aggregateDailyMetrics(db: Database, day: string): Promise<void> {
  const totals = await db.query(
    `SELECT verified_country_code AS country_code, count(*)::numeric AS total
     FROM users
     WHERE verified_country_code IS NOT NULL
     GROUP BY verified_country_code`
  );

  for (const row of totals.rows) {
    await db.query(
      `INSERT INTO countrylinqa_metrics_daily (metric_date, metric_key, country_code, region_code, metric_value, dimensions)
       VALUES ($1, 'users.total', $2, NULL, $3, '{}'::jsonb)
       ON CONFLICT (metric_date, metric_key, country_code, region_code, dimensions)
       DO UPDATE SET metric_value = EXCLUDED.metric_value`,
      [day, row.country_code, row.total]
    );
  }
}
