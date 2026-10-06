import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createSessionRefresher } from "../clients/mobile/services/session-refresh.ts";
import { OnboardingApiService } from "../clients/mobile/services/onboarding.service.ts";
import { FailClosedAccessTokenProvider, setActiveAccountSessionResolver } from "../clients/mobile/services/session.ts";
import { apiReady, portAvailable, selectDevice, resolveAndroidLaunchArgs } from "../scripts/lib/mobile-launch.mjs";

const expired = {
  userId: "user", accessToken: "old-access", refreshToken: "old-refresh",
  sessionId: "session", expiresAt: new Date(0).toISOString()
};
function fixture() {
  let saved: unknown = null;
  let removed = false;
  return {
    store: { load: async () => expired, save: async (value: unknown) => { saved = value; }, remove: async () => { removed = true; } },
    saved: () => saved, removed: () => removed
  };
}

test("refresh retains stored credentials during server and network outages", async (t) => {
  for (const status of [429, 500, 503]) {
    const f = fixture();
    t.mock.method(globalThis, "fetch", async () => new Response("{}", { status }));
    await assert.rejects(createSessionRefresher(f.store, "http://api")("user"), /try again/);
    assert.equal(f.removed(), false);
    assert.equal(f.saved(), null);
    t.mock.restoreAll();
  }
  const f = fixture();
  t.mock.method(globalThis, "fetch", async () => { throw new Error("network unavailable"); });
  await assert.rejects(createSessionRefresher(f.store, "http://api")("user"), /could not connect/);
  assert.equal(f.removed(), false);
});

test("invalid refresh credentials clear only the rejected session", async (t) => {
  const f = fixture();
  t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 401 }));
  assert.equal(await createSessionRefresher(f.store, "http://api")("user"), null);
  assert.equal(f.removed(), true);
});

test("concurrent refreshes share a single request and persist the rotated token", async (t) => {
  const f = fixture();
  const load = t.mock.method(f.store, "load");
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ accessToken: "new-access", refreshToken: "new-refresh", accessTokenExpiresIn: 3600 }));
  const refresh = createSessionRefresher(f.store, "http://api");
  const results = await Promise.all([refresh("user"), refresh("user")]);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(load.mock.callCount(), 1);
  assert.equal(results[0]?.refreshToken, "new-refresh");
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(f.saved(), results[0]);
});

test("malformed successful responses cannot replace stored credentials", async (t) => {
  const f = fixture();
  t.mock.method(globalThis, "fetch", async () => Response.json({ accessToken: "incomplete" }));
  await assert.rejects(createSessionRefresher(f.store, "http://api")("user"), /invalid session response/);
  assert.equal(f.saved(), null);
  assert.equal(f.removed(), false);
});

test("a failed refresh can be retried", async (t) => {
  const f = fixture();
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => ++attempts === 1
    ? new Response("{}", { status: 503 })
    : Response.json({ accessToken: "new-access", refreshToken: "new-refresh", accessTokenExpiresIn: 3600 }));
  const refresh = createSessionRefresher(f.store, "http://api");
  await assert.rejects(refresh("user"));
  assert.equal((await refresh("user"))?.accessToken, "new-access");
});

test("onboarding recognizes HTTP 401 even without a JSON body", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 401 }));
  const client = new OnboardingApiService("http://api", { getAccessToken: async () => "token" });
  await assert.rejects(client.status(), /AUTH_REQUIRED/);
});

test("session connection errors remain retryable and never return an expired token", async (t) => {
  t.after(() => setActiveAccountSessionResolver(null));
  t.mock.method(console, "warn", () => {});
  setActiveAccountSessionResolver(async () => { throw new Error("offline"); });
  await assert.rejects(new FailClosedAccessTokenProvider().getAccessToken(), /Check your connection/);
  setActiveAccountSessionResolver(async () => expired);
  await assert.rejects(new FailClosedAccessTokenProvider().getAccessToken(), /No active authenticated session/);
});

test("device selection rejects unauthorized devices and ambiguous choices", () => {
  assert.equal(selectDevice("List of devices attached\nphone device model:SM_A037U\n"), "phone");
  assert.throws(() => selectDevice("phone unauthorized\n"), /authorize/);
  assert.throws(() => selectDevice("one device\ntwo device\n"), /Multiple/);
  assert.equal(selectDevice("one device\ntwo device\n", "two"), "two");
  assert.throws(() => selectDevice("one device\n", "missing"), /not connected/);
});

test("launcher distinguishes Linqa readiness from Apache and occupied ports", async (t) => {
  let body = "<html>Apache</html>";
  const server = http.createServer((_request, response) => response.end(body));
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as { port: number }).port;
  assert.equal(await portAvailable(port), false);
  assert.equal(await apiReady(port), false);
  body = JSON.stringify({ status: "ready" });
  assert.equal(await apiReady(port), false);
  body = JSON.stringify({ service: "linqa-api", status: "not-ready" });
  assert.equal(await apiReady(port), false);
  body = JSON.stringify({ service: "linqa-api", status: "ready" });
  assert.equal(await apiReady(port), true);
});

test("launcher detects IPv6-only listeners on localhost", async (t) => {
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "::1", resolve);
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as { port: number }).port;
  assert.equal(await portAvailable(port), false);
});

test("android relaunch sequence force-stops and clears the app task before starting the activity", () => {
  assert.deepEqual(resolveAndroidLaunchArgs("com.linqa.mobile", ".MainActivity"), {
    forceStop: ["shell", "am", "force-stop", "com.linqa.mobile"],
    start: [
      "shell",
      "am",
      "start",
      "-S",
      "-n",
      "com.linqa.mobile/.MainActivity",
      "-a",
      "android.intent.action.MAIN",
      "-c",
      "android.intent.category.LAUNCHER"
    ]
  });
});
