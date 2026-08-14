import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/pool.js";
import { TrustSafetyService } from "../services/trust-safety.service.js";

describe("TrustSafetyService", () => {
  it("submits a report without evidence", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO safety_reports")) {
        return {
          rows: [{ id: "report-1", status: "OPEN", severity: "MEDIUM", sla_due_at: "later" }],
          rowCount: 1
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const service = new TrustSafetyService({ query } as unknown as Database);

    const report = await service.submitReport({
      reporterUserId: "user-1",
      category: "HARASSMENT",
      description: "This user sent repeated harassing messages."
    });

    expect(report.id).toBe("report-1");
  });

  it("attaches evidence only when the reporter owns a completed upload", async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM attachment_uploads")) {
        expect(params).toEqual(["attachment-1", "user-1"]);
        return { rows: [{ id: "attachment-1" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO safety_reports")) {
        expect(params?.[7]).toBe("attachment-1");
        return {
          rows: [{ id: "report-1", status: "OPEN", severity: "CRITICAL", sla_due_at: "soon" }],
          rowCount: 1
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const service = new TrustSafetyService({ query } as unknown as Database);

    const report = await service.submitReport({
      reporterUserId: "user-1",
      category: "MINOR_SAFETY",
      description: "Evidence attached for review.",
      evidenceAttachmentId: "attachment-1"
    });

    expect(report.id).toBe("report-1");
  });

  it("rejects evidence that is not the reporter's own completed upload", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM attachment_uploads")) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected query: ${sql}`);
    });
    const service = new TrustSafetyService({ query } as unknown as Database);

    await expect(
      service.submitReport({
        reporterUserId: "user-1",
        category: "HARASSMENT",
        description: "Trying to attach someone else's upload.",
        evidenceAttachmentId: "not-mine"
      })
    ).rejects.toThrow("evidence attachment not found or incomplete");
  });

  it("prevents a user from blocking themselves", async () => {
    const query = vi.fn();
    const service = new TrustSafetyService({ query } as unknown as Database);

    await expect(
      service.block({ blockerUserId: "user-1", blockedUserId: "user-1" })
    ).rejects.toThrow("cannot block self");
    expect(query).not.toHaveBeenCalled();
  });
});
