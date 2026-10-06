import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import type { Database } from "../db/pool.js";
import { RegulatedEntityResolverV7, ResponsibilityRequirementService, snapshotSha256, type FinancialResponsibility } from "../services/linqasend/regulatory-v7.js";
import { ensureTestDatabase } from "./support/test-database.js";

/**
 * Real PostgreSQL, one transaction rolled back at the end (and per test via
 * savepoints). Replays migration 045, then checks the v7 resolver SQL against
 * seeded entities, contracts and maps, plus the snapshot invariants the
 * database itself must enforce.
 */
const database = await ensureTestDatabase();
const suite = database ? describe : describe.skip;

let client: pg.PoolClient;
let pool: pg.Pool;
let db: Database;
let savepoint = 0;

const args = { sourceCountry: "US", destinationCountry: "US", transferClass: "INTERNAL_DOMESTIC", sourceCurrency: "USD", destinationCurrency: "USD", fundingMode: "BANK", receiveMode: "BANK" };

async function seed(opts: { entityStatus?: string; diligence?: string; health?: string; contract?: "ACTIVE" | "EXPIRED" | "NONE"; adapter?: string | null; skip?: FinancialResponsibility } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const entityId = `ent-${suffix}`;
  await client.query(
    `INSERT INTO linqasend_financial_entities_v7 (id, legal_name, display_name, entity_type, country_code, status, due_diligence_status, operational_status)
     VALUES ($1,'Acme Bank','Acme','BANK','US',$2,$3,$4)`, [entityId, opts.entityStatus ?? "ACTIVE", opts.diligence ?? "APPROVED", opts.health ?? "HEALTHY"]);
  const required = new ResponsibilityRequirementService().derive({ ...args, custodyModel: "NO_CUSTOMER_FUNDS" });
  const responsibilities = (Object.keys(required) as FinancialResponsibility[]).filter((r) => required[r] !== "NOT_APPLICABLE");
  const entities = Object.fromEntries(responsibilities.filter((r) => r !== opts.skip).map((r) => [r, entityId]));
  if (opts.contract !== "NONE") {
    await client.query(
      `INSERT INTO linqasend_partner_contracts_v7 (id, entity_id, contract_set_id, status, responsibilities, effective_from, effective_to, executed_document_ref, provider_adapter_key)
       VALUES ($1,$2,'set-1','ACTIVE',$3, now() - interval '2 days', $4, 'DOC-1', $5)`,
      [`con-${suffix}`, entityId, responsibilities, opts.contract === "EXPIRED" ? new Date(Date.now() - 86_400_000) : null, opts.adapter === undefined ? "acme" : opts.adapter]);
  }
  await client.query(
    `INSERT INTO linqasend_financial_responsibility_maps_v7 (source_country, destination_country, transfer_class, source_currency, destination_currency, funding_mode, receive_mode,
       custody_model, responsibility_entities, legal_approval_reference, partner_approval_reference, contract_set_id, policy_version, effective_from, status)
     VALUES ('US','US','INTERNAL_DOMESTIC','USD','USD','BANK','BANK','NO_CUSTOMER_FUNDS',$1,'LEGAL-1','PARTNER-1','set-1',1, now() - interval '1 day','ACTIVE')`,
    [JSON.stringify(entities)]);
  return { entityId };
}

suite("LinqaSend v7 responsibility (real SQL)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: database!.connectionString, max: 1 });
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(readFileSync(resolve("src/db/migrations/045_linqasend_v7_execution_closure.sql"), "utf8"));
    // A shared development database may already hold real maps that would shadow the fixtures.
    await client.query(`UPDATE linqasend_financial_responsibility_maps_v7 SET status = 'SUSPENDED' WHERE status = 'ACTIVE'`);
    db = { query: (sql: string, params?: unknown[]) => client.query(sql, params as any[]) } as unknown as Database;
  });
  afterAll(async () => {
    await client?.query("ROLLBACK");
    client?.release();
    await pool?.end();
    await database?.stop();
  });
  beforeEach(async () => { await client.query(`SAVEPOINT t${++savepoint}`); });
  afterEach(async () => { await client.query(`ROLLBACK TO SAVEPOINT t${savepoint}`); });

  it("a complete map resolves READY and carries the contract's adapter key", async () => {
    await seed();
    const resolution = await new RegulatedEntityResolverV7(db).resolve(args);
    expect(resolution.blockedReasons).toEqual([]);
    expect(resolution.complete).toBe(true);
    expect(resolution.authorities.every((a) => a.providerAdapterKey === "acme")).toBe(true);
  });

  it("capability is not enough: no map means blocked", async () => {
    const resolution = await new RegulatedEntityResolverV7(db).resolve(args);
    expect(resolution.complete).toBe(false);
    expect(resolution.blockedReasons).toContain("FINANCIAL_RESPONSIBILITY_MAP_NOT_CONFIGURED");
  });

  it.each([
    ["inactive partner", { entityStatus: "SUSPENDED" }, "ENTITY_NOT_ACTIVE"],
    ["due diligence not approved", { diligence: "PENDING" }, "ENTITY_DUE_DILIGENCE_NOT_APPROVED"],
    ["partner DOWN", { health: "DOWN" }, "PARTNER_OPERATIONALLY_UNAVAILABLE"],
    ["partner UNKNOWN", { health: "UNKNOWN" }, "PARTNER_OPERATIONALLY_UNAVAILABLE"],
    ["expired contract", { contract: "EXPIRED" as const }, "CONTRACT_NOT_FOUND"],
    ["missing contract", { contract: "NONE" as const }, "CONTRACT_NOT_FOUND"]
  ])("blocks: %s", async (_name, opts, reason) => {
    await seed(opts);
    const resolution = await new RegulatedEntityResolverV7(db).resolve(args);
    expect(resolution.complete).toBe(false);
    expect(resolution.blockedReasons.join(",")).toContain(reason);
  });

  it("blocks a required responsibility with no entity (bank payout)", async () => {
    await seed({ skip: "LOCAL_BANK_PAYOUT" });
    const resolution = await new RegulatedEntityResolverV7(db).resolve(args);
    expect(resolution.complete).toBe(false);
    expect(resolution.missingResponsibilities).toContain("LOCAL_BANK_PAYOUT");
  });

  it("allows only one snapshot per transfer and never lets one be changed or removed", async () => {
    const transferId = randomUUID();
    const insert = (hash: string) => client.query(
      `INSERT INTO linqasend_responsibility_snapshots_v7 (transfer_id, policy_version, resolution, snapshot_hash, complete) VALUES ($1, 1, '{}'::jsonb, $2, true)`, [transferId, hash]);
    await insert(snapshotSha256({ n: 1 }));
    await client.query("SAVEPOINT dup");
    await expect(insert(snapshotSha256({ n: 2 }))).rejects.toMatchObject({ code: "23505" });
    await client.query("ROLLBACK TO SAVEPOINT dup");
    await client.query("SAVEPOINT mut");
    await expect(client.query(`UPDATE linqasend_responsibility_snapshots_v7 SET complete = false WHERE transfer_id = $1`, [transferId])).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT mut");
    await client.query("SAVEPOINT del");
    await expect(client.query(`DELETE FROM linqasend_responsibility_snapshots_v7 WHERE transfer_id = $1`, [transferId])).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT del");
  });
});
