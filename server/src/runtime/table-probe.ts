import { capability, type CapabilityProbe } from "./capabilities.js";
export class TableCapabilityProbe implements CapabilityProbe {
  constructor(readonly key: string, private readonly db: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }, private readonly tables: string[]) {}
  async probe() {
    try {
      const result = await this.db.query(
        `SELECT bool_and(to_regclass('public.' || name) IS NOT NULL) AS ready FROM unnest($1::text[]) AS name`,
        [this.tables]
      );
      return result.rows[0]?.ready === true
        ? capability(this.key, "READY", this.tables.map((name) => ({ name, state: "READY" as const })))
        : capability(this.key, "DEGRADED", this.tables.map((name) => ({ name, state: "DEGRADED" as const })), { reason: "required database objects are missing" });
    } catch (error) {
      return capability(this.key, "DEGRADED", [], { reason: String(error) });
    }
  }
}

