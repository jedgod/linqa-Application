// Read-only development diagnostic. Never prints OTP hashes, salts, or credentials.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = path.join(root, "server/.env");
if (fs.existsSync(env)) process.loadEnvFile(env);
if (process.env.NODE_ENV === "production") throw new Error("This diagnostic is for local development only.");
const identifier = process.argv[2];
if (!identifier) throw new Error("Usage: node scripts/inspect-auth-challenges.mjs <phone-or-email>");
const require = createRequire(path.join(root, "server/package.json"));
const { Client } = require("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const result = await client.query(
    "SELECT id, identifier_type, purpose, attempts_remaining, created_at, expires_at, consumed_at, superseded_at, " +
    "CASE WHEN consumed_at IS NOT NULL THEN 'CONSUMED' WHEN superseded_at IS NOT NULL THEN 'SUPERSEDED' " +
    "WHEN expires_at <= now() THEN 'EXPIRED' WHEN attempts_remaining <= 0 THEN 'LOCKED' ELSE 'ACTIVE' END AS status " +
    "FROM authentication_challenges WHERE normalized_identifier = $1 ORDER BY created_at DESC LIMIT 12",
    [identifier]
  );
  const account = await client.query(
    "SELECT u.status, ai.verified_at IS NOT NULL AS verified, ai.disabled_at IS NOT NULL AS disabled " +
    "FROM account_identifiers ai JOIN users u ON u.id=ai.user_id WHERE ai.normalized_value=$1",
    [identifier]
  );
  await client.query("ROLLBACK");
  const twilioConfigured = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
  console.log(JSON.stringify({
    identifierSuffix: identifier.slice(-4), nodeEnv: process.env.NODE_ENV ?? "development",
    smsDelivery: twilioConfigured ? "Twilio configured" : "Development console (no SMS)",
    account: account.rows, challenges: result.rows
  }, null, 2));
} catch (error) {
  console.error("Challenge inspection failed: " + error.message);
  process.exitCode = 1;
} finally { await client.end(); }
