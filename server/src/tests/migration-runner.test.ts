import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "../db/migration-runner.js";

class LedgerDb {
  rows = new Map<string,{checksum_sha256:string;dirty:boolean}>();
  queries:string[]=[];
  async query(sql:string,params:unknown[]=[]):Promise<{rows:any[];rowCount:number}> {
    this.queries.push(sql.trim());
    if(sql.startsWith("SELECT checksum_sha256")){const row=this.rows.get(String(params[0]));return {rows:row?[row]:[],rowCount:row?1:0};}
    if(sql.includes("INSERT INTO schema_migrations")){this.rows.set(String(params[0]),{checksum_sha256:String(params[1]),dirty:true});return {rows:[],rowCount:1};}
    if(sql.includes("UPDATE schema_migrations")){const row=this.rows.get(String(params[0]));if(row)row.dirty=false;return {rows:[],rowCount:row?1:0};}
    return {rows:[],rowCount:0};
  }
}

describe("G4 migration ledger",()=>{
  it("locks, records checksums, replays idempotently, and rejects changed history",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"linqa-migrations-")); const file=join(directory,"001_test.sql");
    await writeFile(file,"CREATE TABLE gate_test(id int);\n"); const db=new LedgerDb();
    await migrate(db,directory,"gate-test"); await migrate(db,directory,"gate-test");
    expect(db.queries.some((sql)=>sql.includes("pg_advisory_lock"))).toBe(true);
    expect(db.rows.get("001_test.sql")?.dirty).toBe(false);
    await writeFile(file,"CREATE TABLE gate_test(id bigint);\n");
    await expect(migrate(db,directory,"gate-test")).rejects.toThrow("Migration checksum mismatch");
  });
});
