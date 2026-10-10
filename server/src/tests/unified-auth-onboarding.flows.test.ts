import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/pool.js";
import { OnboardingService, type OnboardingNextStep } from "../services/onboarding.service.js";
import { discoveryEntitlements } from "../services/countrylinqa/entitlements.js";

type State = {
  status?: string; phone_verified?: boolean; device_enrolled?: boolean;
  recovery_required?: boolean; recovery_ready?: boolean; verified_country_code?: string | null;
  country_verification_state?: string; discovery_configured?: boolean;
  profile_ready?: boolean; registration_required?: boolean; completion_screen_seen_at?: string | null;
};

function flow(state: State) {
  const query = vi.fn(async (sql: string) => sql.includes("FROM users u")
    ? { rows: [{ status: "ACTIVE", phone_verified: true, device_enrolled: true,
        recovery_required: false, recovery_ready: true, verified_country_code: "US",
        country_verification_state: "VERIFIED", discovery_configured: true, profile_ready: true, ...state }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  return { service: new OnboardingService({ query } as unknown as Database), query };
}

describe("Unified Authentication + Onboarding flows", () => {
  const cases: Array<[string, State, OnboardingNextStep]> = [
    ["every new registration requires name and stage name before recovery", { registration_required: true, profile_ready: false, recovery_required: true, recovery_ready: false }, "PROFILE_SETUP"],
    ["completed registration missing its names resumes profile setup", { registration_required: true, profile_ready: false, completion_screen_seen_at: "2026-08-14T00:00:00Z" }, "PROFILE_SETUP"],
    ["brand-new registration requires recovery after device enrollment", { recovery_required: true, recovery_ready: false }, "RECOVERY_SETUP"],
    ["existing configured user enters Home", {}, "COMPLETE"],
    ["interrupted registration resumes its missing recovery step", { recovery_required: true, recovery_ready: false }, "RECOVERY_SETUP"],
    ["device enrollment is required before profile hydration", { device_enrolled: false }, "DEVICE_ENROLLMENT"],
    ["missing CountryLinqa country is inserted into onboarding", { verified_country_code: null }, "COUNTRY_CONFIRMATION"],
    ["country confirmed without discovery resumes discovery", { discovery_configured: false }, "COUNTRY_DISCOVERY"],
    ["new account sees completion once after discovery", { registration_required: true, completion_screen_seen_at: null }, "COMPLETION"],
    ["acknowledged completion proceeds to Home", { registration_required: true, completion_screen_seen_at: "2026-08-14T00:00:00Z" }, "COMPLETE"],
    ["blocked account fails closed after required setup", { status: "BLOCKED" }, "SECURITY_REVIEW"],
    ["phone evidence is authoritative", { phone_verified: false }, "AUTH_REQUIRED"]
  ];
  for (const [name, state, expected] of cases) {
    it(name, async () => {
      const { service, query } = flow(state);
      const result = await service.status("00000000-0000-4000-8000-000000000001", state.device_enrolled === false ? undefined : "00000000-0000-4000-8000-000000000002");
      expect(result.nextStep).toBe(expected);
      expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO onboarding_state"))).toBe(true);
    });
  }

  it("prevents completion acknowledgment before required names are saved", async () => {
    const { service } = flow({ registration_required: true, profile_ready: false });
    await expect(service.acknowledgeCompletion("user-1", "device-1")).rejects.toThrow("onboarding_not_complete");
  });

  it("saves the name privately and uses the stage name for display", async () => {
    const { service, query } = flow({ registration_required: true, profile_ready: false });
    await service.saveProfile("user-1", "device-1", "Jane Doe", "Jazzy Jane");
    expect(query.mock.calls.at(-1)?.[0]).toContain("display_name=EXCLUDED.stage_name");
    expect((query.mock.calls.at(-1) as unknown as [string, string[]])[1]).toEqual(["user-1", "Jane Doe", "Jazzy Jane"]);
  });

  it("rejects profile writes from an unenrolled device", async () => {
    const { service, query } = flow({ device_enrolled: false });
    await expect(service.saveProfile("user-1", undefined, "Jane", "Jazz")).rejects.toThrow("profile_setup_not_allowed");
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO user_profiles"))).toBe(false);
  });

  it("persists new-account recovery policy for resume", async () => {
    const { service, query } = flow({});
    await service.markNewRegistration("00000000-0000-4000-8000-000000000001");
    expect(String(query.mock.calls[0]?.[0])).toContain("recovery_required");
  });

  it("subscription downgrade uses the same entitlement matrix exposed to UI", () => {
    expect(discoveryEntitlements("FREE")).toEqual({ MY_COUNTRY: true, SELECTED_COUNTRIES: false, REGION: false, GLOBAL: false });
    expect(discoveryEntitlements("PREMIUM").GLOBAL).toBe(false);
    expect(discoveryEntitlements("ELITE").GLOBAL).toBe(true);
  });

  it("returns the server-derived phone country for confirmation", async () => {
    const { service } = flow({});
    const query = (service as any).db.query as ReturnType<typeof vi.fn>;
    query.mockImplementation(async (sql: string) => sql.includes("FROM users u")
      ? { rows: [{ status: "ACTIVE", phone_verified: true, device_enrolled: true, recovery_required: false,
          recovery_ready: true, verified_country_code: null, country_verification_state: "UNVERIFIED",
          discovery_configured: false, profile_ready: true, detected_country_code: "US", detected_country_name: "United States",
          detected_calling_code: "+1", registration_required: true }], rowCount: 1 }
      : { rows: [], rowCount: 1 });
    const status = await service.status("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002");
    expect(status.detectedCountry).toEqual({ code: "US", name: "United States", callingCode: "+1" });
  });

  it("acknowledges the completion screen idempotently only after technical completion", async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [{ completion_screen_seen_at: "2026-08-14T12:00:00Z" }], rowCount: 1 }));
    const service = new OnboardingService({ query } as unknown as Database);
    vi.spyOn(service, "status").mockResolvedValue({
      profileReady: true, phoneVerified: true, deviceEnrollmentRequired: false, recoveryReady: true, recoveryRequired: true,
      countryInitialized: true, countryVerificationState: "VERIFIED", discoveryConfigured: true,
      blockers: [], detectedCountry: { code: "US", name: "United States", callingCode: "+1" },
      onboardingCompletedAt: "2026-08-14T11:59:00Z", completionScreenSeen: false, nextStep: "COMPLETION"
    });
    await expect(service.acknowledgeCompletion("user-1", "device-1")).resolves.toMatchObject({ completionScreenSeen: true });
    expect(String(query.mock.calls[0]?.[0])).toContain("completion_screen_seen_at=COALESCE");
  });
});
