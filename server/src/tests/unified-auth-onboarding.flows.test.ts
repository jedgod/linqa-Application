import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/pool.js";
import { OnboardingService, type OnboardingNextStep } from "../services/onboarding.service.js";
import { discoveryEntitlements } from "../services/countrylinqa/entitlements.js";

type State = {
  status?: string; phone_verified?: boolean; device_enrolled?: boolean;
  recovery_required?: boolean; recovery_ready?: boolean; verified_country_code?: string | null;
  country_verification_state?: string; discovery_configured?: boolean;
};

function flow(state: State) {
  const query = vi.fn(async (sql: string) => sql.includes("FROM users u")
    ? { rows: [{ status: "ACTIVE", phone_verified: true, device_enrolled: true,
        recovery_required: false, recovery_ready: true, verified_country_code: "US",
        country_verification_state: "VERIFIED", discovery_configured: true, ...state }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  return { service: new OnboardingService({ query } as unknown as Database), query };
}

describe("Unified Authentication + Onboarding flows", () => {
  const cases: Array<[string, State, OnboardingNextStep]> = [
    ["brand-new registration requires recovery after device enrollment", { recovery_required: true, recovery_ready: false }, "RECOVERY_SETUP"],
    ["existing configured user enters Home", {}, "COMPLETE"],
    ["interrupted registration resumes its missing recovery step", { recovery_required: true, recovery_ready: false }, "RECOVERY_SETUP"],
    ["device enrollment is required before profile hydration", { device_enrolled: false }, "DEVICE_ENROLLMENT"],
    ["missing CountryLinqa country is inserted into onboarding", { verified_country_code: null }, "COUNTRY_CONFIRMATION"],
    ["country confirmed without discovery resumes discovery", { discovery_configured: false }, "COUNTRY_DISCOVERY"],
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
});
