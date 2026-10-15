import test from "node:test";
import assert from "node:assert/strict";
import { assertMessagingUnlocked, createMessagingGate, resolveProtectionLevel } from "../clients/mobile/services/conversation-gate.ts";

const ready = { "secure-core": { state: "READY" }, "message-relay": { state: "READY" }, "key-transparency": { state: "READY" } } as never;

test("messaging requires verified OS-protected or hardware-backed keys", async () => {
  for (const level of ["HARDWARE_BACKED", "OS_PROTECTED", "SOFTWARE_REQUIRES_OS_WRAPPING", "unknown", "", null, undefined]) {
    let asked = false;
    const gate = createMessagingGate({
      core: { version: async () => "1", protectionLevel: async () => level } as never,
      capabilities: async () => { asked = true; return ready; }
    });
    const protectedKeys = level === "HARDWARE_BACKED" || level === "OS_PROTECTED";
    assert.deepEqual(await gate.evaluate(), protectedKeys ? { mode: "LIVE" } : { mode: "LOCKED", reason: "KEY_PROTECTION_REQUIRED" });
    assert.equal(asked, protectedKeys);
  }
});

test("a failing protection probe keeps messaging locked", async () => {
  const gate = createMessagingGate({
    core: { version: async () => "1", protectionLevel: async () => { throw new Error("keystore unavailable"); } },
    capabilities: async () => ready
  });
  assert.deepEqual(await gate.evaluate(), { mode: "LOCKED", reason: "PROBE_FAILED" });
});

test("protection assertion rejects absent cores and probe failures", async () => {
  assert.deepEqual(await resolveProtectionLevel(null), { level: "UNKNOWN", reason: "SECURE_CORE_UNAVAILABLE" });
  await assert.rejects(assertMessagingUnlocked(null), { code: "MESSAGING_KEY_PROTECTION_REQUIRED" });
  await assert.rejects(assertMessagingUnlocked({ version: async () => "1", protectionLevel: async () => "SOFTWARE_REQUIRES_OS_WRAPPING" }), { code: "MESSAGING_KEY_PROTECTION_REQUIRED" });
  await assertMessagingUnlocked({ version: async () => "1", protectionLevel: async () => "OS_PROTECTED" });
});
