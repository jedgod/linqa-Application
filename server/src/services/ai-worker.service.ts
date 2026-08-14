import type { Database } from "../db/pool.js";

export interface ConfidentialAiProvider {
  process(input: {
    jobType: string;
    inputCiphertext: Buffer;
  }): Promise<Buffer>;
}

export class FailClosedConfidentialAiProvider
  implements ConfidentialAiProvider {
  async process(): Promise<never> {
    throw new Error("Confidential AI provider is not configured.");
  }
}

export class AiWorkerService {
  constructor(
    private readonly db: Database,
    private readonly provider: ConfidentialAiProvider
  ) {}

  async lease(workerId: string) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `WITH candidate AS (
           SELECT id
           FROM ai_processing_jobs
           WHERE status = 'QUEUED'
             AND privacy_mode = 'CONFIDENTIAL_CLOUD'
             AND expires_at > now()
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE ai_processing_jobs j
         SET status = 'RUNNING'
         FROM candidate
         WHERE j.id = candidate.id
         RETURNING j.*`
      );

      const job = result.rows[0];
      if (!job) {
        await client.query("COMMIT");
        return null;
      }

      await client.query(
        `INSERT INTO ai_worker_leases (
           job_id,
           worker_id,
           lease_expires_at,
           attempts
         ) VALUES ($1,$2,now() + interval '5 minutes',1)
         ON CONFLICT (job_id)
         DO UPDATE SET
           worker_id = EXCLUDED.worker_id,
           lease_expires_at = EXCLUDED.lease_expires_at,
           attempts = ai_worker_leases.attempts + 1,
           updated_at = now()`,
        [job.id, workerId]
      );

      await client.query("COMMIT");
      return job;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async execute(workerId: string) {
    const job = await this.lease(workerId);
    if (!job) return { processed: false };

    try {
      const output = await this.provider.process({
        jobType: job.job_type,
        inputCiphertext: job.input_ciphertext
      });

      await this.db.query(
        `UPDATE ai_processing_jobs
         SET status = 'COMPLETED',
             output_ciphertext = $2,
             completed_at = now()
         WHERE id = $1`,
        [job.id, output]
      );

      await this.db.query(
        `DELETE FROM ai_worker_leases WHERE job_id = $1`,
        [job.id]
      );

      return { processed: true, jobId: job.id };
    } catch (error) {
      await this.db.query(
        `UPDATE ai_processing_jobs
         SET status = 'FAILED'
         WHERE id = $1`,
        [job.id]
      );

      await this.db.query(
        `UPDATE ai_worker_leases
         SET last_error = $2,
             updated_at = now()
         WHERE job_id = $1`,
        [
          job.id,
          error instanceof Error ? error.message : "unknown"
        ]
      );

      throw error;
    }
  }
}
