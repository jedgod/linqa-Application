import type { Database } from "../db/pool.js";

const ACK_TARGET_MINUTES: Record<string, number> = {
  SEV0: 5,
  SEV1: 10,
  SEV2: 30,
  SEV3: 120,
  SEV4: 480
};

export class IncidentResponseService {
  constructor(private readonly db: Database) {}

  async declare(input: {
    incidentKey: string;
    title: string;
    severity: "SEV0" | "SEV1" | "SEV2" | "SEV3" | "SEV4";
    commander: string;
    securityRelated?: boolean;
    privacyRelated?: boolean;
    impact?: string;
  }) {
    const result = await this.db.query(
      `INSERT INTO incidents_v2(
         incident_key,title,severity,state,commander,
         security_related,privacy_related,customer_impact
       ) VALUES($1,$2,$3,'DECLARED',$4,$5,$6,$7)
       RETURNING id,incident_key,severity,state,started_at`,
      [
        input.incidentKey,
        input.title,
        input.severity,
        input.commander,
        input.securityRelated ?? false,
        input.privacyRelated ?? false,
        input.impact ?? null
      ]
    );

    await this.db.query(
      `INSERT INTO incident_events_v2(
         incident_id,event_type,actor,message,metadata
       ) VALUES($1,'DECLARED',$2,$3,$4)`,
      [
        result.rows[0].id,
        input.commander,
        input.title,
        { acknowledgementTargetMinutes: ACK_TARGET_MINUTES[input.severity] }
      ]
    );

    return result.rows[0];
  }

  async transition(input: {
    incidentId: string;
    actor: string;
    state: "INVESTIGATING" | "MITIGATING" | "MONITORING" | "RESOLVED" | "POSTMORTEM";
    message: string;
  }) {
    const fields =
      input.state === "RESOLVED"
        ? ",resolved_at=now()"
        : input.state === "MONITORING"
          ? ",mitigated_at=COALESCE(mitigated_at,now())"
          : "";

    const result = await this.db.query(
      `UPDATE incidents_v2
       SET state=$2 ${fields}
       WHERE id=$1
       RETURNING id,state`,
      [input.incidentId, input.state]
    );

    if (result.rowCount !== 1) {
      throw new Error("incident not found");
    }

    await this.db.query(
      `INSERT INTO incident_events_v2(
         incident_id,event_type,actor,message
       ) VALUES($1,$2,$3,$4)`,
      [input.incidentId, input.state, input.actor, input.message]
    );
  }
}
