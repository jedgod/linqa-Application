import { describe, expect, it } from "vitest";
import fixture from "../../../../tests/protocol-fixtures/envelope-v1.json";
import { encodeProtocolFixture } from "./ProtocolFixture";

describe("protocol envelope v1 fixture", () => {
  it("matches the Rust bytes exactly", async () => {
    const encoded = encodeProtocolFixture(fixture);
    expect(encoded).toHaveLength(fixture.encodedLength);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(encoded)),
    );
    expect(Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""))
      .toBe(fixture.sha256);
  });
});