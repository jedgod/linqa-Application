import { describe, expect, it } from "vitest";
import { readArchiveChunk } from "./historySync";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const entry = { c: "conv-1", i: "m1", s: "user-1", t: "2026-10-01T10:00:00.000Z", p: "hello" };

describe("reading an opened history piece", () => {
  it("keeps well-formed messages", () => {
    const out = readArchiveChunk(bytes({ v: 1, tr: "t1", n: 0, e: [entry] }), "t1", 0);
    expect(out).toEqual([{ conversationId: "conv-1", entry: { id: "m1", senderUserId: "user-1", at: entry.t, text: "hello" } }]);
  });

  it("refuses a piece from another transfer or another place in this one", () => {
    expect(() => readArchiveChunk(bytes({ v: 1, tr: "other", n: 0, e: [entry] }), "t1", 0)).toThrow("ARCHIVE_MISMATCH");
    expect(() => readArchiveChunk(bytes({ v: 1, tr: "t1", n: 3, e: [entry] }), "t1", 0)).toThrow("ARCHIVE_MISMATCH");
    expect(() => readArchiveChunk(bytes({ v: 2, tr: "t1", n: 0, e: [entry] }), "t1", 0)).toThrow("ARCHIVE_MISMATCH");
  });

  it("drops malformed messages without failing the piece", () => {
    const out = readArchiveChunk(bytes({ v: 1, tr: "t1", n: 0, e: [entry, { ...entry, i: "" }, { ...entry, t: "not a date" }, { ...entry, p: 5 }, null] }), "t1", 0);
    expect(out).toHaveLength(1);
  });
});
