import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/pool.js";
import { OrganizationAuthorizationService } from "../services/organization-authorization.service.js";

describe("OrganizationAuthorizationService", () => {
  it("allows a subject with a matching, unrevoked, unexpired grant", async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      expect(sql).toContain("FROM organization_api_grants");
      expect(params).toEqual(["org-a", "scim-client"]);
      return { rows: [{ scopes: ["scim:write"] }], rowCount: 1 };
    });
    const database = { query } as unknown as Database;

    const service = new OrganizationAuthorizationService(database);
    await expect(
      service.requireScope({
        organizationId: "org-a",
        subject: "scim-client",
        requiredScope: "scim:write"
      })
    ).resolves.toBeUndefined();
  });

  it("denies a subject whose grant belongs to a different organization", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const database = { query } as unknown as Database;

    const service = new OrganizationAuthorizationService(database);
    await expect(
      service.requireScope({
        organizationId: "org-b",
        subject: "scim-client",
        requiredScope: "scim:write"
      })
    ).rejects.toThrow("organization-scoped authorization denied");
  });

  it("denies a grant that exists but lacks the required scope", async () => {
    const query = vi.fn(async () => ({
      rows: [{ scopes: ["profile:read"] }],
      rowCount: 1
    }));
    const database = { query } as unknown as Database;

    const service = new OrganizationAuthorizationService(database);
    await expect(
      service.requireScope({
        organizationId: "org-a",
        subject: "scim-client",
        requiredScope: "scim:write"
      })
    ).rejects.toThrow("organization-scoped authorization denied");
  });
});
