import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { ensureTestDatabase } from "./support/test-database.js";
import { PaymentIntentService } from "../services/linqasend/payment-intent.service.js";
const database = await ensureTestDatabase();
const suite = database ? describe : describe.skip;
suite("payment intents on disposable PostgreSQL", () => {
  let pool: pg.Pool;
  const user = randomUUID(), recipient = randomUUID(), corridor = randomUUID(), quote = randomUUID();
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: database!.connectionString });
    await pool.query("INSERT INTO users(id,external_subject,status) VALUES($1,$2,'ACTIVE')", [user, `intent-${user}`]);
    await pool.query("INSERT INTO linqasend_recipients(id,owner_user_id,recipient_type,display_name,country,preferred_currency) VALUES($1,$2,'BANK','Test recipient','JP','JPY')", [recipient, user]);
    await pool.query("INSERT INTO linqasend_corridors(id,source_country,destination_country,source_currency,destination_currency,min_amount_minor,max_amount_minor,base_margin_bps,min_margin_bps,max_margin_bps,provider) VALUES($1,'US','JP','USD','JPY',1,100000,0,0,0,$2)", [corridor, `test-${corridor}`]);
    await pool.query("INSERT INTO linqasend_quotes(id,user_id,recipient_id,corridor_id,send_amount_minor,send_currency,receive_amount_minor,receive_currency,market_reference_rate,provider_execution_rate,customer_rate,margin_bps,expires_at) VALUES($1,$2,$3,$4,100,'USD',150,'JPY',150,150,150,0,now()+interval '5 minutes')", [quote,user,recipient,corridor]);
  });
  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM linqasend_payment_intents WHERE user_id=$1", [user]);
      await pool.query("DELETE FROM linqasend_quotes WHERE id=$1", [quote]);
      await pool.query("DELETE FROM linqasend_recipients WHERE id=$1", [recipient]);
      await pool.query("DELETE FROM linqasend_corridors WHERE id=$1", [corridor]);
      await pool.query("DELETE FROM users WHERE id=$1", [user]);
      await pool.end();
    }
    await database?.stop();
  });
  it("creates exactly one identity under eight concurrent retry/restart requests", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => new PaymentIntentService(pool).resolve(user, quote)));
    expect(new Set(results.map(result => result.idempotencyKey)).size).toBe(1);
    expect(Number((await pool.query("SELECT count(*) FROM linqasend_payment_intents WHERE quote_id=$1", [quote])).rows[0].count)).toBe(1);
  });
  it("cannot resolve a different user's quote", async () => {
    await expect(new PaymentIntentService(pool).resolve(randomUUID(), quote)).rejects.toThrow("QUOTE_EXPIRED_OR_NOT_OWNED");
  });
});
