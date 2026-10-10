import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { SignJWT } from "jose";
import type { AppConfig } from "../config.js";
import type { OnboardingService } from "../services/onboarding.service.js";
import { registerOnboardingRoutes } from "../routes/onboarding.js";
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function fixture() {
  const app = Fastify(); apps.push(app);
  const service = { saveProfile: vi.fn().mockResolvedValue({ saved: true }), profile: vi.fn().mockResolvedValue({ fullName: "Jane Doe", stageName: "Jazz" }) };
  const config = { NODE_ENV: "test", JWT_HS256_SECRET: "profile-route-test-secret", JWT_ISSUER: "test", JWT_AUDIENCE: "test" } as AppConfig;
  await registerOnboardingRoutes(app, config, service as unknown as OnboardingService);
  const token = await new SignJWT({ user_id: "user-1", device_id: "device-1" }).setProtectedHeader({ alg: "HS256" }).setSubject("user-1").setIssuer("test").setAudience("test").setExpirationTime("5m").sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
  return { app, service, headers: { authorization: "Bearer " + token } };
}
describe("Registration profile API", () => {
  it("requires authentication before storing names", async () => {
    const { app, service } = await fixture();
    expect((await app.inject({ method: "POST", url: "/v1/onboarding/profile", payload: { fullName: "Jane", stageName: "Jazz" } })).statusCode).toBe(401);
    expect(service.saveProfile).not.toHaveBeenCalled();
  });
  it.each([{ fullName: "", stageName: "Jazz" }, { fullName: "Jane", stageName: "   " }, { fullName: "Jane" }, { fullName: "x".repeat(101), stageName: "Jazz" }, { fullName: "Jane", stageName: "Jazz\n" + "Injected" }])("rejects invalid names %j", async payload => {
    const { app, service, headers } = await fixture();
    const response = await app.inject({ method: "POST", url: "/v1/onboarding/profile", headers, payload });
    expect(response.statusCode).toBe(400); expect(service.saveProfile).not.toHaveBeenCalled();
  });
  it("trims both names and stores them for the authenticated account", async () => {
    const { app, service, headers } = await fixture();
    expect((await app.inject({ method: "POST", url: "/v1/onboarding/profile", headers, payload: { fullName: " Jane Doe ", stageName: " Jazz " } })).statusCode).toBe(200);
    expect(service.saveProfile).toHaveBeenCalledWith("user-1", "device-1", "Jane Doe", "Jazz");
  });
  it("preserves enrollment restrictions", async () => {
    const { app, service, headers } = await fixture(); service.saveProfile.mockRejectedValue(new Error("profile_setup_not_allowed"));
    expect((await app.inject({ method: "POST", url: "/v1/onboarding/profile", headers, payload: { fullName: "Jane", stageName: "Jazz" } })).statusCode).toBe(403);
  });
});
