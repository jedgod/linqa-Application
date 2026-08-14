import type { Database } from "../db/pool.js";

export interface ArchiveStorage {
  writeJsonLines(input: { objectKey: string; rows: unknown[] }): Promise<void>;
}

/** No archive object storage bucket is configured in this environment. */
export class FailClosedArchiveStorage implements ArchiveStorage {
  async writeJsonLines(): Promise<never> {
    throw new Error("Archive storage is not configured.");
  }
}

export class RetentionArchiveService {
  constructor(
    private readonly db: Database,
    private readonly archive: ArchiveStorage
  ) {}

  async queue(dataClass: string, cutoffAt: Date) {
    const result = await this.db.query(
      `INSERT INTO archive_jobs_v2(
         data_class,cutoff_at,state
       ) VALUES($1,$2,'QUEUED')
       RETURNING id,state,created_at`,
      [dataClass, cutoffAt]
    );
    return result.rows[0];
  }

  async archiveSecurityAudit(jobId: string) {
    const job = await this.db.query(
      `SELECT * FROM archive_jobs_v2
       WHERE id=$1 AND state='QUEUED'`,
      [jobId]
    );
    const row = job.rows[0];
    if (!row) throw new Error("queued archive job not found");

    const legalHold = await this.db.query(`SELECT 1 FROM legal_holds_v2 WHERE active=TRUE LIMIT 1`);

    if ((legalHold.rowCount ?? 0) > 0) {
      throw new Error("active legal hold blocks destructive archive");
    }

    await this.db.query(`UPDATE archive_jobs_v2 SET state='RUNNING' WHERE id=$1`, [jobId]);

    // FIX (2026-08-07 apply pass): the pack read from a nonexistent
    // security_audit_v2 table. The equivalent existing table
    // (013_industrial_completion.sql) is `operational_audit_events`
    // (has a severity column, matching "security audit" semantics).
    const data = await this.db.query(
      `SELECT *
       FROM operational_audit_events
       WHERE created_at<$1
       ORDER BY created_at
       LIMIT 10000`,
      [row.cutoff_at]
    );

    const objectKey = `archives/security-audit/${jobId}.jsonl`;

    await this.archive.writeJsonLines({
      objectKey,
      rows: data.rows
    });

    const deleted = await this.db.query(`DELETE FROM operational_audit_events WHERE id=ANY($1::uuid[])`, [
      data.rows.map((r) => r.id)
    ]);

    await this.db.query(
      `UPDATE archive_jobs_v2
       SET state='COMPLETED',
           archived_rows=$2,
           deleted_rows=$3,
           object_key=$4,
           completed_at=now()
       WHERE id=$1`,
      [jobId, data.rowCount ?? 0, deleted.rowCount ?? 0, objectKey]
    );

    return {
      archived: data.rowCount ?? 0,
      deleted: deleted.rowCount ?? 0,
      objectKey
    };
  }
}
