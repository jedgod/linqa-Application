import type { Database } from "../db/pool.js";

export class DataResidencyService {
  constructor(private readonly db: Database) {}

  async assignment(subjectType: "USER" | "ORGANIZATION", subjectId: string) {
    const result = await this.db.query(
      `SELECT region_code,residency_policy,effective_at
       FROM data_residency_assignments_v2
       WHERE subject_type=$1 AND subject_id=$2`,
      [subjectType, subjectId]
    );

    return result.rows[0] ?? null;
  }

  async requireRegion(input: { subjectType: "USER" | "ORGANIZATION"; subjectId: string; requestedRegion: string }) {
    const assignment = await this.assignment(input.subjectType, input.subjectId);

    if (!assignment) {
      throw new Error("data residency assignment missing");
    }

    if (assignment.residency_policy === "STRICT" && assignment.region_code !== input.requestedRegion) {
      throw new Error(`strict residency requires ${assignment.region_code}`);
    }

    const region = await this.db.query(
      `SELECT active,supports_user_data
       FROM region_catalog_v2
       WHERE region_code=$1`,
      [assignment.region_code]
    );

    if (region.rows[0]?.active !== true || region.rows[0]?.supports_user_data !== true) {
      throw new Error("assigned data region unavailable");
    }

    return assignment.region_code as string;
  }
}
