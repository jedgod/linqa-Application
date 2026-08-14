import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { EncryptedIndexedDbStore } from "./EncryptedIndexedDbStore";
import type { LocalMessage } from "./EncryptedLocalStore";

function message(overrides: Partial<LocalMessage> = {}): LocalMessage {
  return {
    id: crypto.randomUUID(),
    conversationId: "conversation-1",
    direction: "OUTGOING",
    ciphertext: new TextEncoder().encode("real end-to-end ciphertext bytes"),
    state: "QUEUED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

async function readRawStoredBytes(id: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("linqa-messages:test-account", 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("messages", "readonly");
      const getRequest = tx.objectStore("messages").get(id);
      getRequest.onsuccess = () => {
        resolve(getRequest.result.sealedCiphertext as Uint8Array);
        db.close();
      };
      getRequest.onerror = () => reject(getRequest.error);
    };
    request.onerror = () => reject(request.error);
  });
}

describe("EncryptedIndexedDbStore", () => {
  beforeEach(() => {
    indexedDB.deleteDatabase("linqa-messages:test-account");
    indexedDB.deleteDatabase("linqa-messages:other-account");
    indexedDB.deleteDatabase("linqa-key-custody");
  });

  it("persists and returns a message unchanged through put -> list", async () => {
    const store = new EncryptedIndexedDbStore("test-account");
    const msg = message();

    await store.putMessage(msg);
    const pending = await store.listPendingOutbox(10);

    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(msg.id);
    expect(Array.from(pending[0].ciphertext)).toEqual(Array.from(msg.ciphertext));
  });

  it("wraps ciphertext at rest — the raw IndexedDB bytes are not the plaintext ciphertext", async () => {
    const store = new EncryptedIndexedDbStore("test-account");
    const msg = message();

    await store.putMessage(msg);
    const rawBytes = await readRawStoredBytes(msg.id);

    expect(Array.from(rawBytes)).not.toEqual(Array.from(msg.ciphertext));
  });

  it("excludes messages once they move to a terminal state", async () => {
    const store = new EncryptedIndexedDbStore("test-account");
    const msg = message();

    await store.putMessage(msg);
    await store.updateMessageState(msg.id, "ACCEPTED_BY_RELAY");

    expect(await store.listPendingOutbox(10)).toHaveLength(0);
  });

  it("recovers an interrupted upload and includes failed-retryable messages", async () => {
    const store = new EncryptedIndexedDbStore("test-account");
    const msg = message({ state: "UPLOADING" });

    await store.putMessage(msg);
    expect(await store.listPendingOutbox(10)).toHaveLength(1);

    await store.updateMessageState(msg.id, "FAILED_RETRYABLE");
    const pending = await store.listPendingOutbox(10);
    expect(pending).toHaveLength(1);
    expect(pending[0].state).toBe("FAILED_RETRYABLE");
  });

  it("respects the limit and returns oldest-first", async () => {
    const store = new EncryptedIndexedDbStore("test-account");
    const first = message({ createdAt: "2026-01-01T00:00:00.000Z" });
    const second = message({ createdAt: "2026-01-01T00:00:01.000Z" });
    const third = message({ createdAt: "2026-01-01T00:00:02.000Z" });

    await store.putMessage(third);
    await store.putMessage(first);
    await store.putMessage(second);

    const pending = await store.listPendingOutbox(2);
    expect(pending.map((m) => m.id)).toEqual([first.id, second.id]);
  });

  it("throws when updating a message that was never stored", async () => {
    const store = new EncryptedIndexedDbStore("test-account");
    await expect(store.updateMessageState("missing-id", "DELIVERED")).rejects.toThrow(
      "local message not found"
    );
  });

  it("isolates messages and wrapping keys by account", async () => {
    const first = new EncryptedIndexedDbStore("test-account");
    const second = new EncryptedIndexedDbStore("other-account");
    await first.putMessage(message({ id: "same-message-id" }));
    expect(await second.getMessage("same-message-id")).toBeNull();
    expect(await second.listPendingOutbox(10)).toEqual([]);
  });
});
