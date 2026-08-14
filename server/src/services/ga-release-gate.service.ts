import type { Database } from "../db/pool.js";

export class GaReleaseGateService {
  constructor(private readonly db: Database) {}

  async summary() {
    const result = await this.db.query(
      `SELECT key,category,required,status,evidence_uri,
              approved_by,approved_at,updated_at
       FROM ga_release_gates
       ORDER BY category,key`
    );

    const blocking = result.rows.filter(
      (row) => row.required === true && row.status !== "PASS" && row.status !== "WAIVED"
    );

    const criticalFindings = await this.db.query(
      `SELECT count(*)::int AS count
       FROM security_findings_v2
       WHERE severity='CRITICAL'
         AND status NOT IN ('CLOSED','MITIGATED')`
    );

    return {
      gates: result.rows,
      blockingGates: blocking,
      unresolvedCriticalFindings: criticalFindings.rows[0]?.count ?? 0,
      ready: blocking.length === 0 && Number(criticalFindings.rows[0]?.count ?? 0) === 0
    };
  }

  async approve(input: { gateKey: string; approver: string; requester: string; evidenceUri: string; evidenceHash: Buffer }) {
    if (input.approver === input.requester) {
      throw new Error("requester cannot approve own GA gate");
    }

    const result = await this.db.query(
      `UPDATE ga_release_gates
       SET status='PASS',
           evidence_uri=$2,
           evidence_hash=$3,
           approved_by=$4,
           approved_at=now(),
           updated_at=now()
       WHERE key=$1
       RETURNING key,status,approved_at`,
      [input.gateKey, input.evidenceUri, input.evidenceHash, input.approver]
    );

    if (result.rowCount !== 1) {
      throw new Error("release gate not found");
    }

    return result.rows[0];
  }
}
