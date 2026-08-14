import { createHash } from "node:crypto";
import type { Database } from "../db/pool.js";

export class DeviceEnrollmentService {
  constructor(private readonly db: Database) {}

  async begin(input: { userId: string; deviceId: string; enrollmentProof: Buffer }) {
    if (input.enrollmentProof.length < 64) throw new Error("invalid enrollment proof");
    const proofHash = createHash("sha256").update(input.enrollmentProof).digest();

    const result = await this.db.query(
      `INSERT INTO device_enrollments(user_id,device_id,enrollment_status,enrollment_proof,proof_hash)
       VALUES($1,$2,'PENDING',$3,$4)
       ON CONFLICT(device_id) DO UPDATE SET
         enrollment_status='PENDING', enrollment_proof=EXCLUDED.enrollment_proof,
         proof_hash=EXCLUDED.proof_hash, verified_at=NULL, rejected_at=NULL
       RETURNING id,enrollment_status,created_at`,
      [input.userId,input.deviceId,input.enrollmentProof,proofHash]
    );
    return result.rows[0];
  }

  async complete(input: { userId: string; deviceId: string; cryptographicallyVerified: boolean }) {
    if (!input.cryptographicallyVerified) {
      await this.db.query(
        `UPDATE device_enrollments SET enrollment_status='REJECTED',rejected_at=now()
         WHERE user_id=$1 AND device_id=$2`,
        [input.userId,input.deviceId]
      );
      throw new Error("enrollment verification failed");
    }

    const client=await this.db.connect();
    try {
      await client.query("BEGIN");
      const row=await client.query(
        `UPDATE device_enrollments SET enrollment_status='VERIFIED',verified_at=now()
         WHERE user_id=$1 AND device_id=$2 AND enrollment_status='PENDING'
         RETURNING id`,
        [input.userId,input.deviceId]
      );
      if(row.rowCount!==1) throw new Error("pending enrollment not found");
      await client.query(`UPDATE devices SET status='ACTIVE' WHERE id=$1 AND user_id=$2`,[input.deviceId,input.userId]);
      await client.query("COMMIT");
    } catch(error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
