/**
 * Local-dev helper: gives an existing user a callable peer.
 *
 * The Calls screen's contact picker is fed by `/v1/mobile-hub` contacts, which
 * are derived from shared conversations — and placing a call needs the peer to
 * have an ACTIVE device for the server to ring. A freshly onboarded account has
 * neither, so there is nothing to call. This creates both.
 *
 *   DATABASE_URL=... npx tsx src/dev/seed-call-peer.ts --user <uuid> [--name "Peer Name"]
 *
 * Never registered as a route; never runs in production.
 */
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const config = loadConfig();
if (config.NODE_ENV === "production") {
  throw new Error("seed-call-peer must not run in production");
}

const userId = readArg("user");
const peerName = readArg("name") ?? "Avery Chen";
if (!userId) {
  console.error('Usage: npx tsx src/dev/seed-call-peer.ts --user <uuid> [--name "Peer Name"]');
  process.exit(1);
}

const db = createPool(config);
const peerId = randomUUID();
const peerDeviceId = randomUUID();
const conversationId = randomUUID();

const client = await db.connect();
try {
  await client.query("BEGIN");

  const owner = await client.query(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (owner.rowCount !== 1) throw new Error(`user ${userId} does not exist`);

  await client.query(
    `INSERT INTO users (id, external_subject, status) VALUES ($1, $2, 'ACTIVE')`,
    [peerId, `dev-call-peer:${peerId}`]
  );
  await client.query(
    `INSERT INTO user_profiles (user_id, display_name, bio) VALUES ($1, $2, 'Dev call peer')`,
    [peerId, peerName]
  );

  // An ACTIVE, recently-seen device is what makes the peer ringable:
  // CallService.resolveCallableDevice picks the most recent one.
  //
  // Key bytes are built here rather than with md5($1::text) in SQL: reusing a
  // parameter as both uuid and text makes PostgreSQL fail to deduce one type
  // (42P08), the same trap that broke country confirmation.
  const signingKey = Buffer.alloc(32, peerDeviceId.replace(/-/g, "").slice(0, 2), "hex");
  const encryptionKey = Buffer.alloc(32, peerId.replace(/-/g, "").slice(0, 2), "hex");
  await client.query(
    `INSERT INTO devices (id,user_id,device_name,platform,signing_public_key,encryption_public_key,
       status,registered_at,last_seen_at)
     VALUES ($1,$2,$3,'ANDROID',$4,$5,'ACTIVE', now(), now())`,
    [peerDeviceId, peerId, `${peerName.split(" ")[0]} phone`, signingKey, encryptionKey]
  );

  // A shared DIRECT conversation is what makes the peer appear as a contact.
  await client.query(
    `INSERT INTO conversations (id,conversation_type,created_by_user_id,display_title,
       last_message_preview,last_message_at)
     VALUES ($1,'DIRECT',$2,$3,'Say hello to start this conversation', now())`,
    [conversationId, userId, peerName]
  );
  await client.query(
    `INSERT INTO conversation_members (conversation_id,user_id,role)
     VALUES ($1,$2,'OWNER'),($1,$3,'MEMBER')`,
    [conversationId, userId, peerId]
  );

  await client.query("COMMIT");
  console.log(
    JSON.stringify(
      { peerUserId: peerId, peerName, peerDeviceId, conversationId, callableBy: userId },
      null,
      2
    )
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await db.end();
}
