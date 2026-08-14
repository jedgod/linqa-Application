import type { Database } from "../db/pool.js";

export class EnterprisePolicyService {
  constructor(private readonly db: Database) {}

  async get(organizationId:string,key:string) {
    const result=await this.db.query(
      `SELECT policy_value
       FROM enterprise_policies
       WHERE organization_id=$1 AND policy_key=$2 AND enforced=TRUE`,
      [organizationId,key]
    );
    return result.rows[0]?.policy_value??null;
  }

  async set(input:{organizationId:string;key:string;value:unknown}) {
    await this.db.query(
      `INSERT INTO enterprise_policies(
         organization_id,policy_key,policy_value
       ) VALUES($1,$2,$3)
       ON CONFLICT(organization_id,policy_key)
       DO UPDATE SET policy_value=EXCLUDED.policy_value,
                     enforced=TRUE,
                     updated_at=now()`,
      [input.organizationId,input.key,input.value]
    );
  }
}
