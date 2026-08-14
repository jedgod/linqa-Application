import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { buildApp } from "../app.js";

const config = loadConfig({
  ...process.env,
  NODE_ENV: "test"
});

const db = createPool(config);
const app = await buildApp(config, db);

async function tokenFor(userId: string, deviceId: string) {
  const key = new TextEncoder().encode(config.JWT_HS256_SECRET);
  return new SignJWT({
    user_id: userId,
    device_id: deviceId,
    scope: "keys:write messages:send messages:receive"
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`test:${userId}`)
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

let aliceUserId = "";
let bobUserId = "";
let aliceDeviceId = "";
let bobDeviceId = "";

beforeAll(async () => {
  await app.ready();

  const alice = await db.query(
    `INSERT INTO users (external_subject, display_name)
     VALUES ($1, 'Alice Test')
     RETURNING id`,
    [`alice-${crypto.randomUUID()}`]
  );
  const bob = await db.query(
    `INSERT INTO users (external_subject, display_name)
     VALUES ($1, 'Bob Test')
     RETURNING id`,
    [`bob-${crypto.randomUUID()}`]
  );

  aliceUserId = alice.rows[0].id;
  bobUserId = bob.rows[0].id;

  const aliceDevice = await db.query(
    `INSERT INTO devices (
       user_id, device_name, platform, signing_public_key, encryption_public_key
     ) VALUES ($1,'Alice Device','WEB',$2,$3)
     RETURNING id`,
    [aliceUserId, Buffer.alloc(32, 1), Buffer.alloc(32, 2)]
  );

  const bobDevice = await db.query(
    `INSERT INTO devices (
       user_id, device_name, platform, signing_public_key, encryption_public_key
     ) VALUES ($1,'Bob Device','WEB',$2,$3)
     RETURNING id`,
    [bobUserId, Buffer.alloc(32, 3), Buffer.alloc(32, 4)]
  );

  aliceDeviceId = aliceDevice.rows[0].id;
  bobDeviceId = bobDevice.rows[0].id;
});

afterAll(async () => {
  await app.close();
  await db.end();
});

describe("real relay vertical slice", () => {
  it("stores, leases, and acknowledges an opaque envelope", async () => {
    const aliceToken = await tokenFor(aliceUserId, aliceDeviceId);
    const bobToken = await tokenFor(bobUserId, bobDeviceId);
    const clientMessageId = crypto.randomUUID();
    const ciphertext = Buffer.alloc(96, 9).toString("base64");

    const submit = await app.inject({
      method: "POST",
      url: "/v1/relay/envelopes",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        recipientDeviceId: bobDeviceId,
        clientMessageId,
        ciphertextBase64: ciphertext
      }
    });

    expect(submit.statusCode).toBe(201);
    const submitted = submit.json();

    const receive = await app.inject({
      method: "GET",
      url: "/v1/relay/envelopes?limit=10",
      headers: { authorization: `Bearer ${bobToken}` }
    });

    expect(receive.statusCode).toBe(200);
    const batch = receive.json();
    expect(batch.envelopes).toHaveLength(1);
    expect(batch.envelopes[0].ciphertextBase64).toBe(ciphertext);

    const ack = await app.inject({
      method: "POST",
      url: "/v1/relay/acknowledgements",
      headers: { authorization: `Bearer ${bobToken}` },
      payload: {
        leaseOwner: batch.leaseOwner,
        envelopeIds: [submitted.envelopeId]
      }
    });

    expect(ack.statusCode).toBe(200);
    expect(ack.json().acknowledged).toBe(1);
  });

  it("is idempotent for repeated client message IDs", async () => {
    const aliceToken = await tokenFor(aliceUserId, aliceDeviceId);
    const clientMessageId = crypto.randomUUID();
    const payload = {
      recipientDeviceId: bobDeviceId,
      clientMessageId,
      ciphertextBase64: Buffer.alloc(80, 7).toString("base64")
    };

    const first = await app.inject({
      method: "POST",
      url: "/v1/relay/envelopes",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload
    });

    const second = await app.inject({
      method: "POST",
      url: "/v1/relay/envelopes",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().idempotentReplay).toBe(true);
  });
});
