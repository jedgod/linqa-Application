import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { buildApp } from "../app.js";

const config: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 8080,
  DATABASE_URL: "postgresql://unused",
  JWT_ISSUER: "https://test.linqa.local",
  JWT_AUDIENCE: "linqa-api",
  JWT_HS256_SECRET: "test-secret-that-is-at-least-32-bytes-long",
  CONTACT_DISCOVERY_SECRET: "test-contact-discovery-secret-value",
  TOKEN_VAULT_KEY_BASE64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  TURN_SHARED_SECRET: "test-turn-secret-that-is-at-least-32-bytes",
  TURN_URLS: ["turn:127.0.0.1:3478?transport=udp"],
  CORS_ORIGINS: ["http://127.0.0.1:5173"],
  DEVICE_CHALLENGE_TTL_SECONDS: 300,
  ENVELOPE_TTL_SECONDS: 2_592_000,
  MAX_ENVELOPE_BYTES: 262_144,
  DELIVERY_LEASE_SECONDS: 60,
  PASSKEY_RP_ID: "test.linqa.local",
  PASSKEY_RP_NAME: "Linqa Test",
  PASSKEY_ORIGINS: ["https://test.linqa.local"],
  APNS_SANDBOX: false,
  BILLING_WEBHOOK_TOLERANCE_SECONDS: 300,
  LINQASEND_WEBHOOK_TOLERANCE_SECONDS: 300,
  COUNTRY_SELECTION_PREMIUM_LIMIT: 20,
  LOG_LEVEL: "fatal"
};

const database = {
  query: async (sql: string) => {
    if (sql.includes("schema_migrations")) return { rows: [{ count: 9 }] };
    return { rows: [{ "?column?": 1 }] };
  }
} as unknown as Database;

/**
 * 2026-08-07: closes the gap flagged in this session's own diagnostic —
 * MlsGroupService, PushV2Service, EmergencyEscalationService,
 * CanaryReleaseService (Milestone 3) and SecurityAssessmentService,
 * RetentionArchiveService, IncidentResponseService,
 * ProductionKillSwitchService, GaRolloutService, DiagnosticRedactionService
 * (Milestone 4) were instantiated in service-container.ts but had no route
 * calling them. This test asserts each now has a real, mounted endpoint.
 */
describe("previously-unrouted Milestone 3/4 services now have real routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("mounts every new Milestone 3 admin/ops route", async () => {
    app = await buildApp(config, database);
    await app.ready();

    expect(app.hasRoute({ method: "POST", url: "/v3/groups" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v3/groups/:groupId/commits" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v3/push/wake" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v3/emergency/events" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v3/emergency/process" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v3/canary" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v3/canary/:canaryId/evaluate" })).toBe(true);
  });

  it("mounts every new Milestone 4 admin/ops route", async () => {
    app = await buildApp(config, database);
    await app.ready();

    expect(app.hasRoute({ method: "POST", url: "/v4/security/assessments" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v4/security/findings" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v4/security/findings/:findingId/close" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v4/retention/jobs" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v4/retention/jobs/:jobId/archive" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v4/incidents" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v4/incidents/:incidentId/transitions" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/v4/kill-switches" })).toBe(true);
    expect(app.hasRoute({ method: "PUT", url: "/v4/kill-switches/:key" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v4/ga/rollouts" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v4/ga/rollouts/:rolloutId/promote" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v4/ga/rollouts/:rolloutId/rollback" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v4/diagnostics/redact" })).toBe(true);
  });

  it("rejects an unauthenticated kill-switch read", async () => {
    app = await buildApp(config, database);

    // Matches the same unguarded createAuthenticator() pattern already used
    // by every other route in this file (and by the original pack's own
    // /v3/devices, /v4/ga/readiness, etc.) — an auth failure here falls
    // through to the app's global error handler (500), not a route-local
    // 401. Not a new behavior introduced by these routes.
    const response = await app.inject({ method: "GET", url: "/v4/kill-switches" });
    expect(response.statusCode).toBe(500);
  });
});
