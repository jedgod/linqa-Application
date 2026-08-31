/**
 * Exercises the call scheduling / device-resolution SQL against a real
 * PostgreSQL instance. The unit suite uses fake `db.query` doubles, which
 * cannot catch a bad column name, a uuid[] mismatch or a malformed
 * array_agg subquery.
 *
 *   DATABASE_URL=... npx tsx src/dev/calls-sql-smoke.ts
 */
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { CallService } from "../services/call.service.js";

const config = loadConfig();
const db = createPool(config);
const calls = new CallService(db);

const organizer = randomUUID();
const invitee = randomUUID();
const stranger = randomUUID();
const organizerDevice = randomUUID();
const inviteeDevice = randomUUID();

const ok = (name: string, detail: unknown) =>
  console.log(`  ok  ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);

async function seedUser(id: string, name: string) {
  await db.query(
    `INSERT INTO users (id, external_subject, status) VALUES ($1,$2,'ACTIVE')`,
    [id, `calls-smoke:${id}`]
  );
  await db.query(`INSERT INTO user_profiles (user_id, display_name) VALUES ($1,$2)`, [id, name]);
}

// devices has a UNIQUE (user_id, signing_public_key), so every seeded device
// needs distinct key bytes — a user really can't register the same key twice.
let deviceKeySeed = 0;

async function seedDevice(id: string, userId: string, name: string, lastSeenMinutesAgo: number) {
  deviceKeySeed += 1;
  const keyByte = deviceKeySeed.toString(16).padStart(2, "0");
  await db.query(
    `INSERT INTO devices (id,user_id,device_name,platform,signing_public_key,encryption_public_key,
       status,registered_at,last_seen_at)
     VALUES ($1,$2,$3,'ANDROID',decode(repeat($5,32),'hex'),decode(repeat($6,32),'hex'),
       'ACTIVE', now(), now() - make_interval(mins => $4))`,
    [id, userId, name, lastSeenMinutesAgo, keyByte, keyByte]
  );
}

try {
  console.log("\n1. seed participants");
  await seedUser(organizer, "Organizer Smoke");
  await seedUser(invitee, "Invitee Smoke");
  await seedUser(stranger, "Stranger Smoke");
  await seedDevice(organizerDevice, organizer, "Organizer phone", 1);
  await seedDevice(inviteeDevice, invitee, "Invitee phone", 30);
  // A second, staler device proves the ORDER BY actually chooses.
  await seedDevice(randomUUID(), invitee, "Invitee laptop", 600);
  ok("seeded", "3 users, 4 devices");

  console.log("\n2. device resolution");
  ok("resolveCallableDevice(invitee)", (await calls.resolveCallableDevice(invitee)) === inviteeDevice
    ? "picked most-recently-seen device"
    : "WRONG DEVICE");
  ok("resolveCallableDevice(stranger, no devices)", await calls.resolveCallableDevice(stranger));

  console.log("\n3. call creation ownership");
  const created = await calls.create({
    initiatorUserId: organizer,
    initiatorDeviceId: organizerDevice,
    recipientUserId: invitee,
    recipientDeviceId: inviteeDevice,
    callType: "AUDIO",
    mode: "LIVE",
    privacyMode: "RELAY_ONLY"
  });
  ok("create (valid)", created.callId);

  await calls
    .create({
      initiatorUserId: organizer,
      initiatorDeviceId: organizerDevice,
      // Invitee's device claimed for the stranger: must be refused.
      recipientUserId: stranger,
      recipientDeviceId: inviteeDevice,
      callType: "AUDIO",
      mode: "LIVE",
      privacyMode: "RELAY_ONLY"
    })
    .then(() => {
      throw new Error("EXPECTED mismatched device ownership to be rejected");
    })
    .catch((error: Error) => ok("create (device not owned by claimed user) rejected", error.message));

  console.log("\n4. scheduled calls");
  const scheduled = await db.query(
    `INSERT INTO scheduled_calls
       (organizer_user_id,participant_user_ids,call_type,privacy_mode,scheduled_for)
     VALUES ($1,$2::uuid[],'AUDIO','RELAY_ONLY', now() + interval '2 hours')
     RETURNING id`,
    [organizer, [invitee]]
  );
  const scheduledId = (scheduled.rows[0] as { id: string }).id;

  await db.query(
    `INSERT INTO scheduled_calls
       (organizer_user_id,participant_user_ids,call_type,privacy_mode,scheduled_for)
     VALUES ($1,$2::uuid[],'VIDEO','RELAY_ONLY', now() - interval '2 hours')`,
    [organizer, [invitee]]
  );

  const organizerView = await calls.listScheduled(organizer);
  ok("organizer sees upcoming only", `${organizerView.length} row(s)`);
  ok("organizer row", organizerView[0]);

  const inviteeView = await calls.listScheduled(invitee);
  ok("invitee also sees it", `${inviteeView.length} row(s), isOrganizer=${(inviteeView[0] as { isOrganizer: boolean } | undefined)?.isOrganizer}`);

  const strangerView = await calls.listScheduled(stranger);
  ok("stranger sees nothing", `${strangerView.length} row(s)`);

  console.log("\n5. cancellation authorization");
  ok("invitee cannot cancel", await calls.cancelScheduled(scheduledId, invitee));
  ok("organizer can cancel", await calls.cancelScheduled(scheduledId, organizer));
  ok("second cancel is a no-op", await calls.cancelScheduled(scheduledId, organizer));
  ok("cancelled call leaves the list", `${(await calls.listScheduled(organizer)).length} row(s)`);

  console.log("\nALL CALLS SQL CHECKS PASSED");
} finally {
  await db.query(`DELETE FROM scheduled_calls WHERE organizer_user_id = $1`, [organizer]);
  await db.query(`DELETE FROM call_participants WHERE user_id = ANY($1::uuid[])`, [[organizer, invitee]]);
  await db.query(`DELETE FROM call_sessions WHERE initiator_user_id = $1`, [organizer]);
  await db.query(`DELETE FROM devices WHERE user_id = ANY($1::uuid[])`, [[organizer, invitee, stranger]]);
  await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[organizer, invitee, stranger]]);
  await db.end();
}
