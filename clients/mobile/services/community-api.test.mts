import assert from "node:assert/strict";
import { test } from "node:test";
import { CommunityApiError, createCommunityApi } from "./community-api";

type Seen = { url: string; init: RequestInit };

function fixture(respond: (url: string) => Response | Promise<Response>, token: string | null = "tok") {
  const seen: Seen[] = [];
  const api = createCommunityApi("https://api.example.test/", async () => token, (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return respond(url);
  }) as unknown as typeof fetch);
  return { api, seen };
}
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("sends the session token and omits Content-Type when there is no body", async () => {
  const { api, seen } = fixture(() => ok({ status: "joined" }));
  await api.join("c1");
  assert.equal(seen[0]!.url, "https://api.example.test/api/communities/c1/join");
  const headers = seen[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok");
  assert.equal("Content-Type" in headers, false);
  assert.equal(seen[0]!.init.body, undefined);
});

test("encodes the query and path segments", async () => {
  const { api, seen } = fixture(() => ok({ communities: [] }));
  await api.list({ q: "a&b=c %", category: "tech", mine: false, limit: 5 });
  assert.equal(seen[0]!.url, "https://api.example.test/api/communities/?q=a%26b%3Dc%20%25&category=tech&mine=false&limit=5");
  await api.get("../admin");
  assert.equal(seen[1]!.url, "https://api.example.test/api/communities/..%2Fadmin");
});

test("sends JSON bodies with a content type", async () => {
  const { api, seen } = fixture(() => ok({ invite: {} }, 201));
  await api.createInvite("c1", { maxUses: 3 });
  assert.equal((seen[0]!.init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.equal(seen[0]!.init.body, JSON.stringify({ maxUses: 3 }));
});

test("does not call the server without a token", async () => {
  const { api, seen } = fixture(() => ok({}), null);
  await assert.rejects(api.mine(), (e: unknown) => e instanceof CommunityApiError && e.code === "unauthorized");
  assert.equal(seen.length, 0);
});

test("maps server errors, rate limiting, empty bodies and network failures", async () => {
  const expectCode = (promise: Promise<unknown>, code: string, status: number) =>
    assert.rejects(promise, (e: unknown) => e instanceof CommunityApiError && e.code === code && e.status === status);

  await expectCode(fixture(() => ok({ error: "membership_denied" }, 403)).api.join("c"), "membership_denied", 403);
  await expectCode(fixture(() => ok({ error: "not_found" }, 404)).api.get("c"), "not_found", 404);
  await expectCode(fixture(() => ok({ error: "something new" }, 500)).api.get("c"), "unknown", 500);
  await expectCode(fixture(() => ok({ message: "slow down" }, 429)).api.join("c"), "rate_limited", 429);
  await expectCode(fixture(() => new Response("<html>", { status: 502 })).api.get("c"), "unknown", 502);
  await expectCode(createCommunityApi("https://x.test", async () => "t", (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch).get("c"), "network", 0);

  assert.equal(await fixture(() => new Response(null, { status: 204 })).api.leave("c"), undefined);
});
