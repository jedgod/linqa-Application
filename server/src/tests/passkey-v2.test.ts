import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/pool.js";
import { PasskeyV2Service } from "../services/passkey-v2.service.js";

const config = {
  rpName: "Linqa Test",
  rpId: "test.linqa.local",
  origins: ["https://test.linqa.local"]
};

function mockDb(query: (sql: string, params?: unknown[]) => Promise<unknown>): Database {
  return { query } as unknown as Database;
}

describe("PasskeyV2Service", () => {
  it("begins registration with real WebAuthn options scoped to the configured RP", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM webauthn_credentials")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO webauthn_challenges")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new PasskeyV2Service(mockDb(query), config);
    const options = await service.beginRegistration({
      id: "user-1",
      displayName: "Alice"
    });

    expect(options.rp.name).toBe(config.rpName);
    expect(options.rp.id).toBe(config.rpId);
    expect(typeof options.challenge).toBe("string");
    expect(options.challenge.length).toBeGreaterThan(0);
  });

  it("excludes the user's existing, unrevoked credentials from registration", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM webauthn_credentials")) {
        return {
          rows: [{ id: "cred-1", transports: ["internal"] }],
          rowCount: 1
        };
      }
      if (sql.includes("INSERT INTO webauthn_challenges")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new PasskeyV2Service(mockDb(query), config);
    const options = await service.beginRegistration({
      id: "user-1",
      displayName: "Alice"
    });

    expect(options.excludeCredentials?.map((c) => c.id)).toContain("cred-1");
  });

  it("rejects finishing registration when no unconsumed challenge exists", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("UPDATE webauthn_challenges")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new PasskeyV2Service(mockDb(query), config);
    await expect(
      service.finishRegistration({
        userId: "user-1",
        response: {} as never
      })
    ).rejects.toThrow("valid passkey challenge not found");
  });

  it("rejects beginning authentication for a user with no registered passkey", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM webauthn_credentials")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new PasskeyV2Service(mockDb(query), config);
    await expect(service.beginAuthentication("user-1")).rejects.toThrow(
      "no passkey registered"
    );
  });

  it("rejects finishing authentication when no unconsumed challenge exists", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("UPDATE webauthn_challenges")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new PasskeyV2Service(mockDb(query), config);
    await expect(
      service.finishAuthentication({
        userId: "user-1",
        response: { id: "cred-1" } as never
      })
    ).rejects.toThrow("valid passkey challenge not found");
  });

  it("rejects finishing authentication when the credential is unknown", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("UPDATE webauthn_challenges")) {
        return { rows: [{ challenge: "stored-challenge" }], rowCount: 1 };
      }
      if (sql.includes("FROM webauthn_credentials")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = new PasskeyV2Service(mockDb(query), config);
    await expect(
      service.finishAuthentication({
        userId: "user-1",
        response: { id: "cred-1" } as never
      })
    ).rejects.toThrow("passkey credential not found");
  });
});
