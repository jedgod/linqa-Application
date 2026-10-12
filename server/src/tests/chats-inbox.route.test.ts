import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { SignJWT } from "jose";
import { registerChatRoutes } from "../routes/chats.js";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";

const SECRET = "chat-inbox-test-secret-value-at-least-32-chars";

const config = {
  JWT_ISSUER: "https://auth.local.linqa",
  JWT_AUDIENCE: "linqa-api",
  JWT_HS256_SECRET: SECRET
} as unknown as AppConfig;

async function token(scope: string, userId = "11111111-1111-4111-8111-111111111111") {
  return new SignJWT({ user_id: userId, scope })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`linqa-test-${userId}`)
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(SECRET));
}

/**
 * Answers each query by matching a distinctive fragment, so a test does not
 * depend on the exact SQL text beyond the table it is aimed at.
 */
function database(rows: {
  conversations?: unknown[];
  scheduled?: unknown[];
  presence?: unknown[];
  totals?: unknown[];
  updateCount?: number;
}): { db: Database; queries: string[] } {
  const queries: string[] = [];
  const db = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes("UPDATE conversation_members")) {
        return { rows: [], rowCount: rows.updateCount ?? 1 };
      }
      if (sql.includes("FROM scheduled_calls")) return { rows: rows.scheduled ?? [], rowCount: 0 };
      if (sql.includes('AS "unreadTotal"')) return { rows: rows.totals ?? [{}], rowCount: 1 };
      if (sql.includes('AS "conversationId"')) return { rows: rows.conversations ?? [], rowCount: 0 };
      return { rows: rows.presence ?? [], rowCount: 0 };
    })
  } as unknown as Database;
  return { db, queries };
}

async function buildApp(rows: Parameters<typeof database>[0]) {
  const { db, queries } = database(rows);
  const app = Fastify();
  await registerChatRoutes(app, config, db);
  await app.ready();
  return { app, db, queries };
}

const CONVERSATION = {
  conversationId: "22222222-2222-4222-8222-222222222222",
  title: "Avery Chen",
  isGroup: false,
  preview: "Can you sanity check the device flow?",
  updatedAt: "2026-08-31T10:00:00.000Z",
  unreadCount: 2,
  pinned: true,
  muted: false,
  online: true,
  participantNames: ["Avery Chen"],
  e2eeVerified: false
};

describe("chat inbox: authorization", () => {
  it("rejects an unauthenticated read", async () => {
    const { app } = await buildApp({});
    const response = await app.inject({ method: "GET", url: "/v1/chats/inbox" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects a token without the messages scope", async () => {
    const { app } = await buildApp({});
    const response = await app.inject({
      method: "GET",
      url: "/v1/chats/inbox",
      headers: { authorization: `Bearer ${await token("profile:read")}` }
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("scopes every conversation to the caller's own membership", async () => {
    const { app, queries } = await buildApp({ conversations: [CONVERSATION] });
    await app.inject({
      method: "GET",
      url: "/v1/chats/inbox",
      headers: { authorization: `Bearer ${await token("messages:read")}` }
    });
    const conversationQuery = queries.find((sql) => sql.includes("FROM conversations c"));
    // Membership is the authorization boundary; a plain select over
    // `conversations` would expose other people's threads.
    expect(conversationQuery).toContain("JOIN conversation_members cm");
    expect(conversationQuery).toContain("cm.user_id = $1");
    expect(conversationQuery).toContain("removed_at IS NULL");
    await app.close();
  });
});

describe("chat inbox: payload", () => {
  it("returns the conversation with initials and no developer diagnostics", async () => {
    const { app } = await buildApp({
      conversations: [CONVERSATION],
      totals: [{ unreadTotal: 7, all: 5, unread: 2, groups: 1, pinned: 1 }]
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/chats/inbox",
      headers: { authorization: `Bearer ${await token("messages:read")}` }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.conversations[0].initials).toBe("AC");
    expect(body.conversations[0].unreadCount).toBe(2);
    expect(body.unreadTotal).toBe(7);
    expect(body.counts).toEqual({ all: 5, unread: 2, groups: 1, pinned: 1, favorites: 1, archived: 0 });

    // This is a consumer surface: no server version, host, or environment.
    const serialized = JSON.stringify(body).toLowerCase();
    for (const leak of ["postgres", "nodeenv", "node_env", "hostname", "localhost", "pg_"]) {
      expect(serialized).not.toContain(leak);
    }
    await app.close();
  });

  it("never invents a typing label", async () => {
    const { app } = await buildApp({ conversations: [CONVERSATION] });
    const response = await app.inject({
      method: "GET",
      url: "/v1/chats/inbox",
      headers: { authorization: `Bearer ${await token("messages:read")}` }
    });
    // There is no typing transport; guessing one would fabricate a presence
    // claim about another person.
    expect(response.json().conversations[0].typingLabel).toBeUndefined();
    await app.close();
  });

  it("reports e2eeVerified straight from the ratchet lookup", async () => {
    const { app, queries } = await buildApp({
      conversations: [{ ...CONVERSATION, e2eeVerified: true }]
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/chats/inbox",
      headers: { authorization: `Bearer ${await token("messages:read")}` }
    });
    expect(response.json().conversations[0].e2eeVerified).toBe(true);
    expect(queries.find((sql) => sql.includes("FROM conversations c"))).toContain("mls_group_states");
    await app.close();
  });

  it("ships only participant initials, not a member roster", async () => {
    const { app } = await buildApp({
      conversations: [
        {
          ...CONVERSATION,
          isGroup: true,
          title: "Linqa Project Team",
          participantNames: ["Lin Ochoa", "Priya Nair", "Marcus Webb", "Sana Rehman"]
        }
      ]
    });
    const body = (
      await app.inject({
        method: "GET",
        url: "/v1/chats/inbox",
        headers: { authorization: `Bearer ${await token("messages:read")}` }
      })
    ).json();

    expect(body.conversations[0].participantInitials).toEqual(["LO", "PN", "MW"]);
    expect(JSON.stringify(body)).not.toContain("Sana Rehman");
    await app.close();
  });
});

describe("chat inbox: call shortcuts", () => {
  it("exposes the peer on a direct conversation so the row can offer a call", async () => {
    const { app, queries } = await buildApp({
      conversations: [{ ...CONVERSATION, peerUserId: "55555555-5555-4555-8555-555555555555" }]
    });
    const body = (
      await app.inject({
        method: "GET",
        url: "/v1/chats/inbox",
        headers: { authorization: `Bearer ${await token("messages:read")}` }
      })
    ).json();

    expect(body.conversations[0].peerUserId).toBe("55555555-5555-4555-8555-555555555555");
    // Resolved only for DIRECT rows, so a group never leaks a single member.
    expect(queries.find((sql) => sql.includes('AS "conversationId"'))).toContain(
      "CASE WHEN c.conversation_type = 'DIRECT'"
    );
    await app.close();
  });

  it("leaves the peer null on a group, so no call button is offered", async () => {
    const { app } = await buildApp({
      conversations: [{ ...CONVERSATION, isGroup: true, peerUserId: null }]
    });
    const body = (
      await app.inject({
        method: "GET",
        url: "/v1/chats/inbox",
        headers: { authorization: `Bearer ${await token("messages:read")}` }
      })
    ).json();
    expect(body.conversations[0].peerUserId).toBeNull();
    await app.close();
  });
});

describe("chat inbox: filters", () => {
  it.each([
    ["unread", "cm.unread_count > 0"],
    ["groups", "c.conversation_type <> 'DIRECT'"],
    ["pinned", "AND cm.pinned"]
  ])("applies the %s filter in SQL so the limit means matching rows", async (filter, clause) => {
    const { app, queries } = await buildApp({ conversations: [] });
    await app.inject({
      method: "GET",
      url: `/v1/chats/inbox?filter=${filter}`,
      headers: { authorization: `Bearer ${await token("messages:read")}` }
    });
    expect(queries.find((sql) => sql.includes("FROM conversations c"))).toContain(clause);
    await app.close();
  });

  it("rejects an unknown filter rather than silently serving everything", async () => {
    const { app } = await buildApp({});
    const response = await app.inject({
      method: "GET",
      url: "/v1/chats/inbox?filter=nonsense",
      headers: { authorization: `Bearer ${await token("messages:read")}` }
    });
    expect(response.statusCode).toBe(422);
    await app.close();
  });

  it("keeps the unread total across the whole inbox, not the filtered slice", async () => {
    const totalsFor = async (filter: string) => {
      const { app, queries } = await buildApp({
        totals: [{ unreadTotal: 9, all: 5, unread: 3, groups: 1, pinned: 1 }]
      });
      const body = (
        await app.inject({
          method: "GET",
          url: `/v1/chats/inbox?filter=${filter}`,
          headers: { authorization: `Bearer ${await token("messages:read")}` }
        })
      ).json();
      await app.close();
      return { body, sql: queries.find((sql) => sql.includes('AS "unreadTotal"')) };
    };

    const all = await totalsFor("all");
    const groups = await totalsFor("groups");

    // The tab badge must not move when the user taps a filter, so the totals
    // statement has to be filter-independent -- byte for byte.
    expect(groups.body.unreadTotal).toBe(9);
    expect(groups.sql).toBe(all.sql);
  });
});

describe("chat inbox: scheduled call", () => {
  it("labels the card without a title the server cannot read", async () => {
    const startsAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const { app } = await buildApp({
      scheduled: [{ eventId: "33333333-3333-4333-8333-333333333333", callType: "VIDEO", startsAt }]
    });
    const body = (
      await app.inject({
        method: "GET",
        url: "/v1/chats/inbox",
        headers: { authorization: `Bearer ${await token("messages:read")}` }
      })
    ).json();

    expect(body.scheduledCall.callType).toBe("VIDEO");
    // title_ciphertext is encrypted; no plaintext title may appear.
    expect(body.scheduledCall.title).toBeUndefined();
    await app.close();
  });

  it("opens the join window on the server, inside fifteen minutes", async () => {
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    const { app } = await buildApp({
      scheduled: [{ eventId: "33333333-3333-4333-8333-333333333333", callType: "AUDIO", startsAt: soon }]
    });
    const body = (
      await app.inject({
        method: "GET",
        url: "/v1/chats/inbox",
        headers: { authorization: `Bearer ${await token("messages:read")}` }
      })
    ).json();
    expect(body.scheduledCall.joinable).toBe(true);
    await app.close();
  });

  it("keeps join closed for a call that is still hours away", async () => {
    const later = new Date(Date.now() + 4 * 3_600_000).toISOString();
    const { app } = await buildApp({
      scheduled: [{ eventId: "33333333-3333-4333-8333-333333333333", callType: "AUDIO", startsAt: later }]
    });
    const body = (
      await app.inject({
        method: "GET",
        url: "/v1/chats/inbox",
        headers: { authorization: `Bearer ${await token("messages:read")}` }
      })
    ).json();
    expect(body.scheduledCall.joinable).toBe(false);
    await app.close();
  });

  it("returns null when nothing is scheduled", async () => {
    const { app } = await buildApp({ scheduled: [] });
    const body = (
      await app.inject({
        method: "GET",
        url: "/v1/chats/inbox",
        headers: { authorization: `Bearer ${await token("messages:read")}` }
      })
    ).json();
    expect(body.scheduledCall).toBeNull();
    await app.close();
  });
});

describe("chat read receipts", () => {
  it("clears only the caller's own unread counter", async () => {
    const { app, queries } = await buildApp({ updateCount: 1 });
    const response = await app.inject({
      method: "POST",
      url: "/v1/chats/22222222-2222-4222-8222-222222222222/read",
      headers: { authorization: `Bearer ${await token("messages:read")}` }
    });

    expect(response.statusCode).toBe(204);
    const update = queries.find((sql) => sql.includes("UPDATE conversation_members"));
    expect(update).toContain("user_id = $2");
    await app.close();
  });

  it("answers 404 for a conversation the caller is not in, without confirming it exists", async () => {
    const { app } = await buildApp({ updateCount: 0 });
    const response = await app.inject({
      method: "POST",
      url: "/v1/chats/44444444-4444-4444-8444-444444444444/read",
      headers: { authorization: `Bearer ${await token("messages:read")}` }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("CONVERSATION_NOT_FOUND");
    await app.close();
  });

  it("rejects a malformed conversation id", async () => {
    const { app } = await buildApp({});
    const response = await app.inject({
      method: "POST",
      url: "/v1/chats/not-a-uuid/read",
      headers: { authorization: `Bearer ${await token("messages:read")}` }
    });
    expect(response.statusCode).toBe(422);
    await app.close();
  });
});
