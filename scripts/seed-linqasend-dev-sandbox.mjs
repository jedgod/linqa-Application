// Development-only: gives named users a US jurisdiction profile so the sandbox send flow can start.
// Refuses to run unless NODE_ENV=development, the database is on loopback, and LINQASEND_DEV_SANDBOX=true.
// Usage: node --env-file=server/.env scripts/seed-linqasend-dev-sandbox.mjs <userId> [<userId> ...]
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const server = path.join(fileURLToPath(new URL("../", import.meta.url)), "server");
const { Pool } = createRequire(path.join(server, "package.json"))("pg");
const env = process.env;
if ((env.NODE_ENV ?? "development") !== "development") throw new Error("Refusing: NODE_ENV must be development");
if (env.LINQASEND_DEV_SANDBOX !== "true") throw new Error("Refusing: LINQASEND_DEV_SANDBOX must be true");
if (env.LINQASEND_REAL_MONEY_ENABLED === "true") throw new Error("Refusing: real money is enabled");
const db = new URL(env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(db.hostname)) throw new Error("Refusing: database is not on loopback");
// Optional: --corridor US:US:USD:USD creates a sandbox corridor plus a 24h identity FX snapshot.
// Only same-currency pairs are allowed (rate is exactly 1); cross-currency rates are never invented.
const args = process.argv.slice(2);
const corridorFlag = args.findIndex((a) => a === "--corridor");
const corridorSpec = corridorFlag >= 0 ? args.splice(corridorFlag, 2)[1] : undefined;
// Optional: --kyc also writes the sandbox KYC marker (status DEV_SANDBOX_UNVERIFIED, never VERIFIED).
// Optional: --signals refreshes labelled sandbox fraud-signal inputs (country risk, location observation, funding fingerprint).
// The collector requires them fresh (15 min), so run this right before a trial send.
// Optional: --age backdates the users' payment devices and dev-sandbox funding sources by 3 days so a trial send is not
// blocked as "new device / new funding source" on an account that was created minutes ago. The fraud engine is untouched.
const ageFlag = args.indexOf("--age");
const withAge = ageFlag >= 0;
if (withAge) args.splice(ageFlag, 1);
const signalsFlag = args.indexOf("--signals");
const withSignals = signalsFlag >= 0;
if (withSignals) args.splice(signalsFlag, 1);
const kycFlag = args.indexOf("--kyc");
const withKyc = kycFlag >= 0;
if (withKyc) args.splice(kycFlag, 1);
const ids = args;
if (!corridorSpec && (!ids.length || !ids.every((id) => /^[0-9a-f-]{36}$/i.test(id)))) throw new Error("Pass one or more user UUIDs");
if (ids.length && !ids.every((id) => /^[0-9a-f-]{36}$/i.test(id))) throw new Error("Pass valid user UUIDs");

const pool = new Pool({ connectionString: db.href });
try {
  if (corridorSpec) {
    const m = /^([A-Z]{2}):([A-Z]{2}):([A-Z]{3}):([A-Z]{3})$/.exec(corridorSpec);
    if (!m) throw new Error("Use --corridor SRC:DST:SRC_CCY:DST_CCY, for example US:US:USD:USD");
    const [, srcCountry, dstCountry, srcCcy, dstCcy] = m;
    if (srcCcy !== dstCcy) throw new Error("Refusing: only same-currency sandbox corridors are supported (no invented FX rates)");
    await pool.query(
      `INSERT INTO linqasend_corridors(source_country,destination_country,source_currency,destination_currency,min_amount_minor,max_amount_minor,base_margin_bps,min_margin_bps,max_margin_bps,provider,estimated_delivery_text,active)
       VALUES($1,$2,$3,$4,100,500000,0,0,0,'dev-sandbox','Sandbox only - no money moves',true)
       ON CONFLICT(source_country,destination_country,source_currency,destination_currency,provider) DO UPDATE SET active=true,updated_at=now()`,
      [srcCountry, dstCountry, srcCcy, dstCcy]);
    await pool.query(
      `INSERT INTO linqasend_fx_rate_snapshots(provider,base_currency,quote_currency,market_rate,provider_rate,source_timestamp,valid_until)
       VALUES('dev-sandbox',$1,$2,1,1,now(),now()+interval '24 hours')`, [srcCcy, dstCcy]);
    console.log(`Sandbox corridor ${srcCountry}->${dstCountry} ${srcCcy}->${dstCcy} ensured with a 24h identity rate snapshot`);
  }
  for (const id of ids) {
    await pool.query(
      `INSERT INTO user_jurisdiction_profiles_v2(user_id,original_registration_country,verified_residence_country,account_country,current_physical_country,regulatory_entity_id,regulatory_jurisdiction,residence_verified_at)
       VALUES($1,'US','US','US','US','DEV-SANDBOX-US','US',now()) ON CONFLICT(user_id) DO NOTHING`, [id]);
    await pool.query(`INSERT INTO jurisdiction_audit_events_v2(user_id,event_type,metadata) VALUES($1,'DEV_SANDBOX_PROFILE_SEEDED','{"source":"seed-linqasend-dev-sandbox"}')`, [id]);
    console.log(`US sandbox jurisdiction profile ensured for ${id}`);
    if (withAge) {
      const d = await pool.query(`UPDATE linqasend_trusted_payment_devices_v4 SET first_seen_at=now()-interval '3 days' WHERE user_id=$1 AND first_seen_at>now()-interval '3 days'`, [id]);
      const m = await pool.query(`UPDATE linqasend_payment_methods SET created_at=now()-interval '3 days' WHERE user_id=$1 AND provider='dev-sandbox' AND created_at>now()-interval '3 days'`, [id]);
      await pool.query(`INSERT INTO jurisdiction_audit_events_v2(user_id,event_type,metadata) VALUES($1,'DEV_SANDBOX_RECORDS_BACKDATED','{"source":"seed-linqasend-dev-sandbox","days":3}')`, [id]);
      console.log(`Backdated ${d.rowCount} payment device(s) and ${m.rowCount} sandbox funding source(s) for ${id}`);
    }
    if (withSignals) {
      await pool.query(
        `INSERT INTO linqasend_country_risk_signals(country,risk_score,source_reference,observed_at,expires_at,approved_by)
         VALUES('US',10,'DEV_SANDBOX_NOT_A_REAL_RISK_FEED',now(),now()+interval '24 hours','00000000-0000-4000-8000-0000000000d5')
         ON CONFLICT(country) DO UPDATE SET observed_at=now(),expires_at=now()+interval '24 hours',source_reference=excluded.source_reference`);
      await pool.query(
        `INSERT INTO user_location_observations_v2(user_id,signal_type,country,confidence,observed_at,metadata)
         VALUES($1,'DEV_SANDBOX_SIMULATED','US',0.95,now(),'{"source":"seed-linqasend-dev-sandbox","simulated":true}')`, [id]);
      const methods = await pool.query(`SELECT id FROM linqasend_payment_methods WHERE user_id=$1 AND provider='dev-sandbox' AND deleted_at IS NULL`, [id]);
      for (const m of methods.rows) {
        await pool.query(
          `INSERT INTO linqasend_funding_fingerprints_v4(funding_source_id,provider,provider_fingerprint,owner_user_id)
           VALUES($1,'dev-sandbox',$3,$2)
           ON CONFLICT(provider,provider_fingerprint,owner_user_id) DO UPDATE SET last_seen_at=now()`, [m.id, id, createHash("sha256").update(`dev-sandbox:${m.id}`).digest("hex")]);
      }
      console.log(`Sandbox fraud-signal inputs refreshed for ${id} (${methods.rowCount} funding source(s))`);
    }
    if (withKyc) {
      await pool.query(
        `INSERT INTO linqasend_customer_compliance_profiles_v7(user_id,verified_legal_name,verified_country,kyc_level,kyc_status,provider_customer_ref,verified_at,expires_at,source_evidence_ref)
         VALUES($1,'DEV SANDBOX USER','US',1,'DEV_SANDBOX_UNVERIFIED','dev-sandbox',now(),now()+interval '30 days','DEV_SANDBOX_NOT_REAL_KYC')
         ON CONFLICT(user_id) DO NOTHING`, [id]);
      await pool.query(`INSERT INTO jurisdiction_audit_events_v2(user_id,event_type,metadata) VALUES($1,'DEV_SANDBOX_KYC_MARKER_SEEDED','{"source":"seed-linqasend-dev-sandbox","realKyc":false}')`, [id]);
      console.log(`Sandbox KYC marker (not a real verification) ensured for ${id}`);
    }
  }
} finally { await pool.end(); }
