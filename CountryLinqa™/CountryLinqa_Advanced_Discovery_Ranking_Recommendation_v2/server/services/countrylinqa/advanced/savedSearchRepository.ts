import { db } from "../../../db/pool.js";
import { validateFilters } from "./filterValidator.js";

export class SavedSearchRepository {
  async list(userId:string) {
    return (await db.query(`
      SELECT id,name,query_text,filters,alerts_enabled,created_at,updated_at
      FROM countrylinqa_saved_searches
      WHERE user_id=$1
      ORDER BY updated_at DESC
      LIMIT 100
    `,[userId])).rows;
  }

  async create(userId:string,input:any) {
    const filters=validateFilters(input.filters ?? {});
    return (await db.query(`
      INSERT INTO countrylinqa_saved_searches(
        user_id,name,query_text,filters,alerts_enabled
      ) VALUES($1,$2,$3,$4::jsonb,$5)
      RETURNING *
    `,[
      userId,
      String(input.name ?? "").trim().slice(0,80),
      input.query ? String(input.query).trim().slice(0,80) : null,
      JSON.stringify(filters),
      Boolean(input.alertsEnabled)
    ])).rows[0];
  }

  async remove(userId:string,id:string) {
    await db.query(
      `DELETE FROM countrylinqa_saved_searches WHERE id=$1 AND user_id=$2`,
      [id,userId]
    );
  }
}
