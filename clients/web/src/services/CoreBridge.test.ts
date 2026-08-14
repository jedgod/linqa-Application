import { beforeEach, describe, expect, it } from "vitest";
import { DemoCoreAdapter, WasmCoreAdapter } from "./CoreBridge";

describe("CoreBridge fail-closed behavior", () => {
  beforeEach(() => localStorage.clear());

  it("labels demo state as unencrypted", async () => {
    const state = await new DemoCoreAdapter().runtimeState();
    expect(state.kind).toBe("demo");
    expect(state.encrypted).toBe(false);
  });

  it("persists demo messages explicitly as demo data", async () => {
    const adapter = new DemoCoreAdapter();
    const result = await adapter.sendMessage({
      conversationId: "c1",
      clientMessageId: "m1",
      body: "hello",
    });
    expect(result.status).toBe("stored-demo");
    expect(localStorage.getItem("linqa.demo.messages.v1")).toContain("hello");
  });

  it("never reports secure send success when WASM is unavailable", async () => {
    const adapter = new WasmCoreAdapter();
    await expect(
      adapter.sendMessage({
        conversationId: "c1",
        clientMessageId: "m1",
        body: "hello",
      }),
    ).rejects.toThrow(/unavailable/i);
  });
});
