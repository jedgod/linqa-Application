import type { Database } from "../db/pool.js";

export class SupportOperationsService {
  constructor(private readonly db: Database) {}

  async createCase(input: {
    userId?: string;
    organizationId?: string;
    category: string;
    priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    subject: string;
    description: string;
  }) {
    const result = await this.db.query(
      `INSERT INTO support_cases_v2(
         user_id,organization_id,category,priority,state,
         subject,description
       ) VALUES($1,$2,$3,$4,'OPEN',$5,$6)
       RETURNING id,case_number,state,created_at`,
      [input.userId ?? null, input.organizationId ?? null, input.category, input.priority, input.subject, input.description]
    );

    return result.rows[0];
  }

  async assign(input: { caseId: string; team: string; agent: string }) {
    const result = await this.db.query(
      `UPDATE support_cases_v2
       SET assigned_team=$2,
           assigned_agent=$3,
           updated_at=now()
       WHERE id=$1
       RETURNING id,case_number`,
      [input.caseId, input.team, input.agent]
    );

    if (result.rowCount !== 1) {
      throw new Error("support case not found");
    }
  }

  async addEvent(input: {
    caseId: string;
    actorType: "USER" | "STAFF" | "SYSTEM";
    actorId?: string;
    eventType: string;
    body?: string;
    private?: boolean;
  }) {
    await this.db.query(
      `INSERT INTO support_case_events_v2(
         case_id,actor_type,actor_id,event_type,body,private
       ) VALUES($1,$2,$3,$4,$5,$6)`,
      [input.caseId, input.actorType, input.actorId ?? null, input.eventType, input.body ?? null, input.private ?? false]
    );
  }
}
