import { capability, type CapabilityProbe } from "./capabilities.js";
export class DatabaseProbe implements CapabilityProbe {
  readonly key = "database";
  constructor(private readonly db: { query(sql: string): Promise<unknown> }) {}
  async probe() {
    try { await this.db.query("SELECT 1"); return capability(this.key, "READY", [{ name: "postgresql", state: "READY" }]); }
    catch (error) { return capability(this.key, "DEGRADED", [{ name: "postgresql", state: "DEGRADED", reason: String(error) }], { reason: String(error) }); }
  }
}

