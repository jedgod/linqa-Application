import type { Database } from "../db/pool.js";

export class SecurityAssessmentService {
  constructor(private readonly db: Database) {}

  async registerAssessment(input: {
    type: "CRYPTO_AUDIT" | "PEN_TEST" | "ARCH_REVIEW" | "MOBILE_REVIEW";
    assessor: string;
    reportReference: string;
    reportHash: Buffer;
    completedAt?: Date;
  }) {
    const result = await this.db.query(
      `INSERT INTO external_security_assessments(
         assessment_type,assessor_name,report_reference,report_hash,
         completed_at,status
       ) VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id,status,created_at`,
      [
        input.type,
        input.assessor,
        input.reportReference,
        input.reportHash,
        input.completedAt ?? null,
        input.completedAt ? "COMPLETED" : "IN_PROGRESS"
      ]
    );
    return result.rows[0];
  }

  async createFinding(input: {
    assessmentId?: string;
    key: string;
    severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    title: string;
    description: string;
    owner?: string;
    dueAt?: Date;
  }) {
    const result = await this.db.query(
      `INSERT INTO security_findings_v2(
         assessment_id,finding_key,severity,title,description,
         remediation_owner,due_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,finding_key,status,created_at`,
      [input.assessmentId ?? null, input.key, input.severity, input.title, input.description, input.owner ?? null, input.dueAt ?? null]
    );
    return result.rows[0];
  }

  async closeFinding(input: { findingId: string; verifier: string; evidenceUri: string }) {
    const result = await this.db.query(
      `UPDATE security_findings_v2
       SET status='CLOSED',
           evidence_uri=$2,
           verified_by=$3,
           verified_at=now(),
           updated_at=now()
       WHERE id=$1
         AND status IN ('OPEN','IN_PROGRESS','MITIGATED')
       RETURNING id,status,verified_at`,
      [input.findingId, input.evidenceUri, input.verifier]
    );

    if (result.rowCount !== 1) {
      throw new Error("finding cannot be closed");
    }

    return result.rows[0];
  }
}
