// Local-dev-only helper: mints a real, ops-scoped access token without
// walking through OTP delivery + WebAuthn/device-enrollment key signing.
//
// Everything this script does -- create/find a user, verify an identifier,
// upsert an ops_staff_profiles row, mint a session -- is the same DB state
// and the same SessionService/issueAccessToken code path a real enrolled
// staff login produces. It exists only because reproducing the real phone
// OTP + device-enrollment signing ceremony from a browser preview app is a
// separate, much larger piece of work than wiring admin/staff consoles to
// already-built endpoints. Not registered as an HTTP route; never runs in
// production; not imported by any server bootstrap file.
//
// Usage:
//   tsx src/dev/mint-ops-access-token.ts --email ada@example.com --role OPS_ADMIN --name "Ada Admin"
//   tsx src/dev/mint-ops-access-token.ts --phone +15555550100 --role SUPPORT_AGENT --name "Sam Agent" --team "Trust & Safety"

import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { normalizeIdentifier } from "../auth/normalize.js";
import { SessionService } from "../services/session.service.js";
import { scopesForStaffRole, OPS_SCOPES, STAFF_ROLE_SCOPES, type StaffRole } from "../auth/ops-scopes.js";
import { ENROLLED_DEVICE_SCOPES } from "../routes/enrollment.js";
import { PRE_ENROLLMENT_SCOPES } from "../routes/auth.js";

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

const identifierRaw = readArg("email") ?? readArg("phone");
const role = readArg("role") as StaffRole | undefined;
const displayName = readArg("name") ?? "Preview Staff";
const teamName = readArg("team") ?? null;

// Derived from the role map rather than hardcoded, so adding a staff role in
// ops-scopes.ts doesn't silently leave this script rejecting it.
const STAFF_ROLES = Object.keys(STAFF_ROLE_SCOPES) as StaffRole[];

if (!identifierRaw || !role || !OPS_SCOPES.length) {
  console.error(
    `Usage: tsx src/dev/mint-ops-access-token.ts --email <e> --role <${STAFF_ROLES.join("|")}> --name <display name> [--team <team>]\n` +
      "   or: tsx src/dev/mint-ops-access-token.ts --phone <+1555...> --role <...> --name <...>"
  );
  process.exit(1);
}
if (!STAFF_ROLES.includes(role)) {
  console.error(`--role must be one of ${STAFF_ROLES.join(", ")} (got "${role}")`);
  process.exit(1);
}

const config = loadConfig();
const db = createPool(config);

try {
  const identifier = normalizeIdentifier(identifierRaw);

  const existing = await db.query(
    `SELECT ai.user_id, u.external_subject
     FROM account_identifiers ai
     JOIN users u ON u.id = ai.user_id
     WHERE ai.type = $1 AND ai.normalized_value = $2`,
    [identifier.type, identifier.normalized]
  );

  let userId: string;
  let externalSubject: string;

  if (existing.rowCount === 1) {
    userId = existing.rows[0].user_id;
    externalSubject = existing.rows[0].external_subject;
    console.log(`Reusing existing user ${userId} for ${identifier.normalized}`);
  } else {
    externalSubject = `linqa-dev-staff-${randomUUID()}`;
    const user = await db.query(
      `INSERT INTO users (id, external_subject, status) VALUES (gen_random_uuid(), $1, 'ACTIVE') RETURNING id`,
      [externalSubject]
    );
    userId = user.rows[0].id;

    await db.query(
      `INSERT INTO user_profiles (user_id, display_name) VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, displayName]
    );

    await db.query(
      `INSERT INTO account_identifiers (user_id, type, normalized_value, display_value, is_primary, verified_at)
       VALUES ($1, $2, $3, $3, true, now())`,
      [userId, identifier.type, identifier.normalized]
    );

    console.log(`Created new user ${userId} for ${identifier.normalized}`);
  }

  await db.query(
    `INSERT INTO ops_staff_profiles (user_id, display_name, staff_role, team_name, presence, suspended)
     VALUES ($1, $2, $3, $4, 'AVAILABLE', false)
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       staff_role = EXCLUDED.staff_role,
       team_name = EXCLUDED.team_name,
       presence = 'AVAILABLE',
       suspended = false,
       updated_at = now()`,
    [userId, displayName, role, teamName]
  );

  const opsScopes = scopesForStaffRole(role);
  // Real enrollment (routes/enrollment.ts) merges ENROLLED_DEVICE_SCOPES into
  // the *existing* pre-enrollment principal, so a genuine enrolled token also
  // carries PRE_ENROLLMENT_SCOPES -- including profile:read, which
  // /v1/mobile-hub and /v1/mobile/home both require. Minting from
  // ENROLLED_DEVICE_SCOPES alone produced a token that could not read Home.
  const scopes = Array.from(
    new Set([...PRE_ENROLLMENT_SCOPES, ...ENROLLED_DEVICE_SCOPES, ...opsScopes])
  );

  const sessions = new SessionService(db, config);
  const session = await sessions.create({ userId, subject: externalSubject, scopes });

  console.log("\n--- Ops-scoped session minted ---");
  console.log(`userId:        ${userId}`);
  console.log(`staffRole:     ${role}`);
  console.log(`accessToken:   ${session.accessToken}`);
  console.log(`expiresInSecs: ${session.accessTokenExpiresIn}`);
  console.log(`refreshToken:  ${session.refreshToken}`);
  console.log(`opsScopes:     ${opsScopes.join(" ")}`);
  console.log("\nPaste accessToken into the admin/staff preview login screen.");
} finally {
  await db.end();
}
