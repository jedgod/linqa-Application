import { describe, expect, it, vi } from "vitest";
import { PrivacySafeTelemetry } from "../observability/telemetry.js";

describe("PrivacySafeTelemetry", () => {
  it("records aggregate operational attributes", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    new PrivacySafeTelemetry().record({
      name: "relay_delivery",
      value: 1,
      attributes: { result: "accepted", region: "test" }
    });
    expect(output).toHaveBeenCalledOnce();
    output.mockRestore();
  });

  it("rejects sensitive attribute names and values", () => {
    expect(() => new PrivacySafeTelemetry().record({
      name: "unsafe",
      attributes: { message: "hello" }
    })).toThrow(/sensitive telemetry/i);
  });
});