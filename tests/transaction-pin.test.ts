import test from "node:test";
import assert from "node:assert/strict";
import { LOCKOUT_MS, MAX_ATTEMPTS, TransactionPinStore, pinProblem, type PinStorage } from "../clients/mobile/services/transaction-pin.ts";

function memory(): PinStorage & { dump(): Record<string, string> } {
  const data = new Map<string, string>();
  const k = (user: string, key: string) => `${user}/${key}`;
  return {
    get: async (u, key) => data.get(k(u, key)) ?? null,
    put: async (u, key, v) => { data.set(k(u, key), v); },
    remove: async (u, key) => { data.delete(k(u, key)); },
    dump: () => Object.fromEntries(data)
  };
}

test("pinProblem accepts only six digits that are not easy to guess", () => {
  assert.equal(pinProblem("483917"), null);
  for (const bad of ["12345", "1234567", "12a456", "", "      "]) assert.equal(pinProblem(bad), "FORMAT", bad);
  for (const weak of ["000000", "111111", "123456", "654321", "345678", "121212", "123123"]) assert.equal(pinProblem(weak), "WEAK", weak);
});

test("a created PIN verifies, a wrong one does not, and the PIN is never stored in the clear", async () => {
  const storage = memory();
  const store = new TransactionPinStore(storage);
  assert.equal(await store.hasPin("u1"), false);
  assert.deepEqual(await store.verify("u1", "483917"), { ok: false, reason: "NOT_SET", attemptsLeft: 0, lockedUntil: null });
  await store.setPin("u1", "483917");
  assert.equal(await store.hasPin("u1"), true);
  assert.deepEqual(await store.verify("u1", "483917"), { ok: true });
  const wrong = await store.verify("u1", "483918");
  assert.equal(wrong.ok, false);
  assert.equal(JSON.stringify(storage.dump()).includes("483917"), false);
});

test("PINs are per account", async () => {
  const store = new TransactionPinStore(memory());
  await store.setPin("alice", "483917");
  assert.equal(await store.hasPin("bob"), false);
  assert.equal((await store.verify("bob", "483917")).ok, false);
});

test("two PIN hashes for the same PIN differ (salted)", async () => {
  const a = memory(); const b = memory();
  await new TransactionPinStore(a).setPin("u", "483917");
  await new TransactionPinStore(b).setPin("u", "483917");
  assert.notEqual(a.dump()["u/transfer.pin.hash"], b.dump()["u/transfer.pin.hash"]);
  assert.match(a.dump()["u/transfer.pin.hash"]!, /^s1\$2048\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
});

test("weak or malformed PINs cannot be set", async () => {
  const store = new TransactionPinStore(memory());
  await assert.rejects(store.setPin("u", "123456"), /PIN_TOO_EASY_TO_GUESS/);
  await assert.rejects(store.setPin("u", "12"), /PIN_MUST_BE_6_DIGITS/);
});

test("five wrong attempts lock the PIN, even for the right code, until the lockout ends", async () => {
  let now = 1_000_000;
  const store = new TransactionPinStore(memory(), () => now);
  await store.setPin("u", "483917");
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    const r = await store.verify("u", "000001");
    assert.equal(r.ok, false);
    assert.equal((r as { attemptsLeft: number }).attemptsLeft, MAX_ATTEMPTS - i);
  }
  const last = await store.verify("u", "000001");
  assert.equal(last.ok === false && last.reason, "LOCKED");
  const during = await store.verify("u", "483917");
  assert.equal(during.ok === false && during.reason, "LOCKED");
  assert.ok((await store.status("u")).lockedUntil);

  now += LOCKOUT_MS + 1;
  assert.deepEqual(await store.verify("u", "483917"), { ok: true });
  assert.equal((await store.status("u")).attemptsLeft, MAX_ATTEMPTS);
});

test("failed attempts persist across store instances, so restarting the app does not reset the limit", async () => {
  const storage = memory();
  const first = new TransactionPinStore(storage);
  await first.setPin("u", "483917");
  await first.verify("u", "000001");
  await first.verify("u", "000001");
  const reopened = new TransactionPinStore(storage);
  assert.equal((await reopened.status("u")).attemptsLeft, MAX_ATTEMPTS - 2);
});

test("a correct PIN resets the failure count", async () => {
  const store = new TransactionPinStore(memory());
  await store.setPin("u", "483917");
  await store.verify("u", "000001");
  await store.verify("u", "483917");
  assert.equal((await store.status("u")).attemptsLeft, MAX_ATTEMPTS);
});

test("clear removes the PIN", async () => {
  const store = new TransactionPinStore(memory());
  await store.setPin("u", "483917");
  await store.clear("u");
  assert.equal(await store.hasPin("u"), false);
});

test("a PIN stored in the earlier format (no cost recorded, N=2^13) still verifies", async () => {
  const { scrypt } = await import("../clients/mobile/node_modules/@noble/hashes/scrypt.js");
  const { bytesToHex } = await import("../clients/mobile/node_modules/@noble/hashes/utils.js");
  const salt = new Uint8Array(16).fill(7);
  const hash = bytesToHex(scrypt(new TextEncoder().encode("483917"), salt, { N: 2 ** 13, r: 8, p: 1, dkLen: 32 }));
  const storage = memory();
  await storage.put("u", "transfer.pin.hash", `${bytesToHex(salt)}:${hash}`);
  const store = new TransactionPinStore(storage);
  assert.deepEqual(await store.verify("u", "483917"), { ok: true });
  assert.equal((await store.verify("u", "483918")).ok, false);
});
