import { describe, expect, it, vi } from "vitest";
import {
  FinalMessagingOrchestrator,
  type CryptoCore,
  type RelayApi
} from "./FinalMessagingOrchestrator";

function dependencies() {
  const core: CryptoCore = {
    runtimeInfo: vi.fn(async () => ({
      secureCoreReady: true,
      apiVersion: 1,
      protocolVersion: 1
    })),
    encryptMessage: vi.fn(async () => new Uint8Array(64)),
    decryptMessage: vi.fn(async () => ({
      messageId: "m1",
      senderUserId: "u1",
      senderDeviceId: "d1",
      plaintext: "hello"
    }))
  };
  const relay: RelayApi = {
    keyPackages: vi.fn(async () => ({
      keyPackages: [{
        deviceId: "d2",
        packageBase64: "package",
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }]
    })),
    send: vi.fn(async () => ({})),
    receive: vi.fn(async () => ({
      leaseOwner: "lease",
      envelopes: [{ id: "e1", ciphertextBase64: btoa("ciphertext") }]
    })),
    acknowledge: vi.fn(async () => undefined)
  };
  return { core, relay };
}

describe("FinalMessagingOrchestrator", () => {
  it("rejects undersized ciphertext before relay submission", async () => {
    const { core, relay } = dependencies();
    core.encryptMessage = vi.fn(async () => new Uint8Array(8));
    const orchestrator = new FinalMessagingOrchestrator(core, relay);

    await expect(orchestrator.sendText({
      recipientUserId: "u2",
      plaintext: "hello"
    })).rejects.toThrow(/invalid ciphertext/i);
    expect(relay.send).not.toHaveBeenCalled();
  });

  it("acknowledges only envelopes that decrypt successfully", async () => {
    const { core, relay } = dependencies();
    core.decryptMessage = vi.fn(async () => {
      throw new Error("authentication failed");
    });
    const orchestrator = new FinalMessagingOrchestrator(core, relay);

    await expect(orchestrator.receive()).resolves.toEqual([]);
    expect(relay.acknowledge).not.toHaveBeenCalled();
  });
});