import { randomUUID, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import Fastify from "fastify";
import { SignJWT } from "jose";
import { loadConfig } from "../../config.js";
import type { Database } from "../../db/pool.js";
import { findChatContact, normalizeChatPhone } from "../../chat/chat-contacts.service.js";
import { resolveDirectConversation } from "../../chat/chat.service.js";
import { registerChatV2Routes } from "../../chat/chat-v2.routes.js";
import { registerChatRoutes } from "../../routes/chats.js";
import { RealtimeHub } from "../../realtime/hub.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite("phone lookup and shared direct chats", () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = pool as unknown as Database;
  const users: string[] = [];
  let config: ReturnType<typeof loadConfig>;
  const app = Fastify();
  const hub = new RealtimeHub();
  let caller: { id: string; phone: string; deviceId: string }, peer: typeof caller;
  let token: string;
  async function makeUser(name: string, country = "US") {
    const id = randomUUID(), deviceId = randomUUID();
    const phone = "+19" + BigInt("0x" + id.replace(/-/g, "").slice(0,12)).toString().padStart(10,"0").slice(-10);
    await pool.query("INSERT INTO users(id,external_subject,status,verified_country_code,country_verification_state) VALUES($1,$2,'ACTIVE',$3,'VERIFIED')",[id,"chat-lookup-"+id,country]);
    users.push(id);
    await pool.query("INSERT INTO user_profiles(user_id,display_name,stage_name) VALUES($1,$2,$2)",[id,name]);
    await pool.query("INSERT INTO account_identifiers(user_id,type,normalized_value,display_value,verified_at) VALUES($1,'PHONE',$2,$2,now())",[id,phone]);
    await pool.query("INSERT INTO devices(id,user_id,device_name,platform,signing_public_key,encryption_public_key,status) VALUES($1,$2,'Lookup test','ANDROID',$3,$4,'ACTIVE')",[deviceId,id,randomBytes(32),randomBytes(32)]);
    return { id, phone, deviceId };
  }
  async function jwt(scope: string, deviceId = caller.deviceId) {
    return new SignJWT({ user_id: caller.id, device_id: deviceId, scope }).setProtectedHeader({alg:"HS256"}).setSubject(caller.id).setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime("10m").sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
  }
  beforeAll(async () => {
    config = loadConfig();
    caller = await makeUser("Mybusiness Test"); peer = await makeUser("Greene Test");
    token = await jwt("messages:send messages:read");
    await registerChatV2Routes(app,config,db,hub); await registerChatRoutes(app,config,db); await app.ready();
  });
  afterAll(async () => { await app.close(); await pool.query("DELETE FROM conversations WHERE created_by_user_id=ANY($1::uuid[])",[users]); await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[users]); await pool.end(); });
  const lookup = (phone: string, bearer = token) => app.inject({method:"POST",url:"/v1/chats/contacts/find",headers:{authorization:"Bearer "+bearer},payload:{phone}});
  it("normalizes formatted full numbers and refuses partial numbers", () => {
    expect(normalizeChatPhone(" +1 (405) 667-1120 ")).toBe("+14056671120");
    for (const phone of ["4056671120","+1405","+0abc","+1 OR 1=1"]) expect(()=>normalizeChatPhone(phone)).toThrow();
  });
  it("finds the exact verified contact without returning keys or identifiers", async () => {
    const response = await lookup(peer.phone); expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({contact:{id:peer.id,displayName:"Greene Test"}});
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(await findChatContact(db,caller.id,caller.phone)).toBeNull();
    expect(await findChatContact(db,caller.id,"+199999999999999")).toBeNull();
  });
  it("requires authenticated chat permission and a live bound device", async () => {
    expect((await app.inject({method:"POST",url:"/v1/chats/contacts/find",payload:{phone:peer.phone}})).statusCode).toBe(401);
    expect((await lookup(peer.phone,await jwt("messages:read"))).statusCode).toBe(401);
    expect((await lookup(peer.phone,await jwt("messages:send",randomUUID()))).statusCode).toBe(401);
    expect((await lookup("4056671120")).statusCode).toBe(422);
  });
  it("hides unverified, disabled and suspended accounts", async () => {
    const hidden = await makeUser("Hidden test");
    await pool.query("UPDATE account_identifiers SET verified_at=NULL WHERE user_id=$1",[hidden.id]);
    expect(await findChatContact(db,caller.id,hidden.phone)).toBeNull();
    await pool.query("UPDATE account_identifiers SET verified_at=now(),disabled_at=now() WHERE user_id=$1",[hidden.id]);
    expect(await findChatContact(db,caller.id,hidden.phone)).toBeNull();
    await pool.query("UPDATE account_identifiers SET disabled_at=NULL WHERE user_id=$1",[hidden.id]);
    await pool.query("UPDATE users SET status='SUSPENDED' WHERE id=$1",[hidden.id]);
    expect(await findChatContact(db,caller.id,hidden.phone)).toBeNull();
  });
  it("honors phone discovery opt out, country reach and blocks in either direction", async () => {
    await pool.query("INSERT INTO contact_discovery_identifiers(user_id,identifier_type,lookup_token,discoverable) VALUES($1,'PHONE',$2,FALSE)",[peer.id,randomBytes(32)]);
    expect(await findChatContact(db,caller.id,peer.phone)).toBeNull();
    await pool.query("DELETE FROM contact_discovery_identifiers WHERE user_id=$1",[peer.id]);
    const foreign = await makeUser("Foreign test","GH");
    expect(await findChatContact(db,caller.id,foreign.phone)).toBeNull();
    for (const [a,b] of [[caller.id,peer.id],[peer.id,caller.id]]) {
      await pool.query("INSERT INTO blocked_users(blocker_user_id,blocked_user_id) VALUES($1,$2)",[a,b]);
      expect(await findChatContact(db,caller.id,peer.phone)).toBeNull();
      await pool.query("DELETE FROM blocked_users WHERE blocker_user_id=$1 AND blocked_user_id=$2",[a,b]);
    }
  });
  it("opens one shared conversation under repeated and reverse creates, with each peer's name", async () => {
    const replies = await Promise.all([app.inject({method:"POST",url:"/v1/chats/direct",headers:{authorization:"Bearer "+token},payload:{userId:peer.id}}),resolveDirectConversation(db,peer.id,caller.id)]);
    expect([200,201]).toContain(replies[0].statusCode);
    const id = replies[0].json().conversationId; expect(replies[1].conversationId).toBe(id);
    const own = await app.inject({method:"GET",url:"/v1/chats/inbox",headers:{authorization:"Bearer "+token}});
    expect(own.json().conversations.find((x:any)=>x.conversationId===id).title).toBe("Greene Test");
    const peerToken=await new SignJWT({user_id:peer.id,device_id:peer.deviceId,scope:"messages:read"}).setProtectedHeader({alg:"HS256"}).setSubject(peer.id).setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime("10m").sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
    const reverse = await app.inject({method:"GET",url:"/v1/chats/inbox",headers:{authorization:"Bearer "+peerToken}});
    expect(reverse.json().conversations.find((x:any)=>x.conversationId===id).title).toBe("Mybusiness Test");
  });
});
