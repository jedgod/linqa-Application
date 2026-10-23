import assert from "node:assert/strict";
import { historyForServer, looksSensitive, sendSupportMessage, SupportChatError, supportChatMessage, SUGGESTIONS, type ChatMessage } from "./wallet-support-chat.ts";

const m = (role: "user" | "assistant", text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: Math.random().toString(36), role, text, ...extra });

// Sensitive text is caught the same way the server catches it.
for (const text of ["4242 4242 4242 4242", "my card is 4111111111111111", "account 123456789012", "call 240 940 3101", "my pin is 4821", "password: hunter2", "the code is 482913", "CVV=123"]) assert.equal(looksSensitive(text), true, text);
for (const text of ["How are fees calculated?", "How do I load $120.00?", "What is a one-time code?", "Do I need a pin to confirm?", "I sent $2,450.00", ...SUGGESTIONS]) assert.equal(looksSensitive(text), false, text);

// History: recent, starts with the person, drops failures and blanks, respects the length limit.
{
  const long = Array.from({ length: 30 }, (_, i) => m(i % 2 ? "assistant" : "user", `message ${i}`));
  const sent = historyForServer(long);
  assert.ok(sent.length <= 12);
  assert.equal(sent[0]!.role, "user");
  assert.equal(sent.at(-1)!.text, "message 29");
  assert.deepEqual(historyForServer([m("assistant", "hello"), m("user", "q")]), [{ role: "user", text: "q" }]);
  assert.deepEqual(historyForServer([m("user", "bad", { failed: true }), m("user", "good")]), [{ role: "user", text: "good" }]);
  assert.deepEqual(historyForServer([m("user", "   ")]), []);
  assert.equal(historyForServer([m("user", "x".repeat(2000))])[0]!.text.length, 800);
}

// Every failure has a plain sentence, and none echoes a server message.
for (const code of ["AI_DISABLED", "AI_NOT_CONFIGURED", "AI_BUSY", "RATE_LIMITED", "SENSITIVE_DATA", "UNAUTHENTICATED", "INVALID_REQUEST", "OFFLINE", "AI_UNAVAILABLE", "whatever"]) {
  const text = supportChatMessage(code);
  assert.ok(text.length > 10 && text.endsWith("."), code);
}
assert.equal(supportChatMessage("AI_BUSY"), supportChatMessage("RATE_LIMITED"));
assert.match(supportChatMessage("AI_DISABLED"), /AI privacy/);
assert.match(supportChatMessage("who knows"), /Contact support/);

// Sending
const ok = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
const base = { baseUrl: "https://api.test", getToken: async () => "tok" };
{
  let seen: { url: string; init: RequestInit } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ reply: "  Fees are added on top.  " }), { status: 200 }); }) as typeof fetch;
  const reply = await sendSupportMessage({ ...base, messages: [m("user", "How are fees calculated?")], fetchImpl });
  assert.equal(reply, "Fees are added on top.");
  assert.equal(seen!.url, "https://api.test/v2/wallet/support-chat");
  assert.equal((seen!.init.headers as any).authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(String(seen!.init.body)), { messages: [{ role: "user", text: "How are fees calculated?" }] });
}
const fails = async (p: Promise<unknown>) => { try { await p; return "no error"; } catch (e) { return e instanceof SupportChatError ? `${e.code}/${e.status}` : "other:" + String(e); } };
// Nothing is sent for something that must not be, or has nothing to answer.
{
  let called = false;
  const fetchImpl = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
  assert.equal(await fails(sendSupportMessage({ ...base, messages: [m("user", "my card is 4242 4242 4242 4242")], fetchImpl })), "SENSITIVE_DATA/0");
  assert.equal(await fails(sendSupportMessage({ ...base, messages: [], fetchImpl })), "INVALID_REQUEST/0");
  assert.equal(await fails(sendSupportMessage({ ...base, messages: [m("assistant", "hi")], fetchImpl })), "INVALID_REQUEST/0");
  assert.equal(called, false);
}
// Server codes pass through; provider text never does.
assert.equal(await fails(sendSupportMessage({ ...base, messages: [m("user", "hi")], fetchImpl: ok({ error: { code: "AI_DISABLED" } }, 403) as any })), "AI_DISABLED/403");
assert.equal(await fails(sendSupportMessage({ ...base, messages: [m("user", "hi")], fetchImpl: ok({ error: { code: "AI_BUSY" } }, 429) as any })), "AI_BUSY/429");
assert.equal(await fails(sendSupportMessage({ ...base, messages: [m("user", "hi")], fetchImpl: ok({ weird: "shape" }, 500) as any })), "UNAVAILABLE/500");
assert.equal(await fails(sendSupportMessage({ ...base, messages: [m("user", "hi")], fetchImpl: ok({ reply: "   " }) as any })), "UNAVAILABLE/200");
assert.equal(await fails(sendSupportMessage({ ...base, messages: [m("user", "hi")], fetchImpl: (async () => new Response("<html>", { status: 502 })) as any })), "UNAVAILABLE/502");
// Offline, timeout and a missing session.
assert.equal(await fails(sendSupportMessage({ ...base, messages: [m("user", "hi")], fetchImpl: (async () => { throw new TypeError("Network request failed"); }) as any })), "OFFLINE/0");
assert.equal(await fails(sendSupportMessage({ ...base, messages: [m("user", "hi")], timeoutMs: 20, fetchImpl: ((_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as any })), "OFFLINE/0");
assert.equal(await fails(sendSupportMessage({ ...base, getToken: async () => { throw new Error("No active authenticated session is available. Sign in again to continue."); }, messages: [m("user", "hi")], fetchImpl: ok({}) as any })), "UNAUTHENTICATED/0");

console.log("wallet-support-chat: ok");
