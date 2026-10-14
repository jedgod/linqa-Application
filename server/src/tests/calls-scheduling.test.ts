import { describe, expect, it, vi } from "vitest";
import { CallService } from "../services/call.service.js";
import type { Database } from "../db/pool.js";

type Statement = { sql: string; params: unknown[] };

function fakePool(options: {
  devices?: Array<{ id: string; user_id: string }>;
  rows?: unknown[];
  rowCount?: number;
} = {}) {
  const statements: Statement[] = [];
  let released = false;

  const handle = async (sql: string, params: unknown[] = []) => {
    statements.push({ sql, params });
    if (sql.includes("FROM devices") && sql.includes("ANY($1::uuid[])")) {
      return { rows: options.devices ?? [], rowCount: (options.devices ?? []).length };
    }
    if (sql.includes("FROM devices")) {
      return { rows: options.rows ?? [], rowCount: (options.rows ?? []).length };
    }
    if (sql.includes("INSERT INTO call_sessions")) {
      return { rows: [{ id: "11111111-1111-4111-8111-111111111111", created_at: "2026-08-31T00:00:00.000Z" }], rowCount: 1 };
    }
    if (sql.includes("scheduled_calls") && sql.trimStart().toUpperCase().startsWith("UPDATE")) {
      return { rows: [], rowCount: options.rowCount ?? 0 };
    }
    return { rows: options.rows ?? [], rowCount: options.rowCount ?? (options.rows ?? []).length };
  };

  const client = {
    query: vi.fn(handle),
    release: vi.fn(() => {
      released = true;
    })
  };

  const db = {
    query: vi.fn(handle),
    connect: vi.fn(async () => client)
  } as unknown as Database;

  return { db, client, statements, wasReleased: () => released };
}

const CALLER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CALLER_DEVICE = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
const CALLEE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CALLEE_DEVICE = "dddddddd-dddd-4ddd-8ddd-dddddddddd02";

function createInput(overrides: Partial<Parameters<CallService["create"]>[0]> = {}) {
  return {
    initiatorUserId: CALLER,
    initiatorDeviceId: CALLER_DEVICE,
    recipientUserId: CALLEE,
    recipientDeviceId: CALLEE_DEVICE,
    callType: "AUDIO" as const,
    mode: "LIVE" as const,
    privacyMode: "RELAY_ONLY" as const,
    ...overrides
  };
}

describe("call creation: device ownership", () => {
  it("creates a call when both devices belong to their claimed users", async () => {
    const { db, statements } = fakePool({
      devices: [
        { id: CALLER_DEVICE, user_id: CALLER },
        { id: CALLEE_DEVICE, user_id: CALLEE }
      ]
    });

    const call = await new CallService(db).create(createInput());

    expect(call.callId).toBe("11111111-1111-4111-8111-111111111111");
    expect(statements.map((statement) => statement.sql)).toContain("COMMIT");
  });

  it("rejects a device that is active but belongs to someone else", async () => {
    // The pre-existing check only asked "are both ids ACTIVE", so any active
    // device could be written into call_participants as the callee's device.
    const { db, statements } = fakePool({
      devices: [
        { id: CALLER_DEVICE, user_id: CALLER },
        { id: CALLEE_DEVICE, user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }
      ]
    });

    await expect(new CallService(db).create(createInput())).rejects.toThrow("inactive call participant");
    expect(statements.map((statement) => statement.sql)).toContain("ROLLBACK");
  });

  it("rejects when the caller's own device is not theirs", async () => {
    const { db } = fakePool({
      devices: [
        { id: CALLER_DEVICE, user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
        { id: CALLEE_DEVICE, user_id: CALLEE }
      ]
    });
    await expect(new CallService(db).create(createInput())).rejects.toThrow("inactive call participant");
  });

  it("rejects when a device is missing from the active set", async () => {
    const { db } = fakePool({ devices: [{ id: CALLER_DEVICE, user_id: CALLER }] });
    await expect(new CallService(db).create(createInput())).rejects.toThrow("inactive call participant");
  });

  it("rejects a call whose caller and callee device are the same row", async () => {
    const { db } = fakePool({ devices: [{ id: CALLER_DEVICE, user_id: CALLER }] });
    await expect(
      new CallService(db).create(createInput({ recipientDeviceId: CALLER_DEVICE, recipientUserId: CALLER }))
    ).rejects.toThrow("inactive call participant");
  });

  it("releases the pooled client on failure", async () => {
    const { db, wasReleased } = fakePool({ devices: [] });
    await expect(new CallService(db).create(createInput())).rejects.toThrow();
    expect(wasReleased()).toBe(true);
  });
});

describe("callable device resolution", () => {
  it("returns the most recently seen active device", async () => {
    const { db, statements } = fakePool({ rows: [{ id: CALLEE_DEVICE }] });

    await expect(new CallService(db).resolveCallableDevice(CALLEE)).resolves.toBe(CALLEE_DEVICE);

    const sql = statements[0]?.sql ?? "";
    expect(sql).toContain("status = 'ACTIVE'");
    // Ordering matters: this decides which of a user's devices rings.
    expect(sql).toContain("ORDER BY last_seen_at DESC NULLS LAST");
    expect(sql).toContain("LIMIT 1");
  });

  it("returns null when the user has no active device", async () => {
    const { db } = fakePool({ rows: [] });
    await expect(new CallService(db).resolveCallableDevice(CALLEE)).resolves.toBeNull();
  });
});

describe("scheduled calls: listing", () => {
  it("returns upcoming (or still joinable), still-scheduled calls the user is party to", async () => {
    const { db, statements } = fakePool({ rows: [] });
    await new CallService(db).listScheduled(CALLER);

    const sql = statements[0]?.sql ?? "";
    expect(sql).toContain("sc.status = 'SCHEDULED'");
    expect(sql).toContain("sc.scheduled_for > now() - interval '60 minutes'");
    expect(sql).toContain('AS "joinable"');
    // Invitees must see it too, not just the organizer.
    expect(sql).toContain("sc.organizer_user_id = $1 OR $1 = ANY(sc.participant_user_ids)");
    expect(sql).toContain("ORDER BY sc.scheduled_for ASC");
  });

  it("caps and floors the limit", async () => {
    const { db, statements } = fakePool({ rows: [] });
    const service = new CallService(db);

    await service.listScheduled(CALLER, 10_000);
    expect(statements[0]?.params[1]).toBe(200);

    statements.length = 0;
    await service.listScheduled(CALLER, 0);
    expect(statements[0]?.params[1]).toBe(1);
  });

  it("scopes the query to the requesting user", async () => {
    const { db, statements } = fakePool({ rows: [] });
    await new CallService(db).listScheduled(CALLER);
    expect(statements[0]?.params[0]).toBe(CALLER);
  });
});

describe("scheduled calls: cancellation", () => {
  it("cancels when the requester is the organizer", async () => {
    const { db, statements } = fakePool({ rowCount: 1 });
    await expect(new CallService(db).cancelScheduled("sched-1", CALLER)).resolves.toBe(true);

    const sql = statements[0]?.sql ?? "";
    expect(sql).toContain("SET status = 'CANCELLED'");
    // Authorization is in the WHERE clause, so a non-organizer simply matches
    // no rows rather than relying on a separate check.
    expect(sql).toContain("organizer_user_id = $2");
    expect(sql).toContain("status = 'SCHEDULED'");
  });

  it("reports false rather than throwing when nothing matched", async () => {
    // Same answer for "does not exist", "not yours" and "already cancelled",
    // so the endpoint cannot be used to probe for valid ids.
    const { db } = fakePool({ rowCount: 0 });
    await expect(new CallService(db).cancelScheduled("sched-1", CALLER)).resolves.toBe(false);
  });
});
