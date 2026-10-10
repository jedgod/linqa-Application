import { beforeEach, describe, expect, it, vi } from "vitest";
import { BiometricClient } from "../../../mobile/services/biometric-client";

const principal = { userId: "11111111-1111-4111-8111-111111111111",deviceId: "22222222-2222-4222-8222-222222222222",sessionId: "33333333-3333-4333-8333-333333333333",installationId: "44444444-4444-4444-8444-444444444444" };
const token = `header.${btoa(JSON.stringify({ user_id: principal.userId,device_id: principal.deviceId,sid: principal.sessionId }))}.signature`;
const stable = (value: Record<string,unknown>) => JSON.stringify(value,Object.keys(value).sort());
const challenge = { challengeId: "challenge",challenge: "n".repeat(43),purpose: "VAULT_UNLOCK",resourceHashHex: "a".repeat(64),securityEpoch: 1,keyAlias: "linqa.bio.key",expiresAt: new Date(Date.now()+90_000).toISOString() };
const payloadBase64 = btoa(stable({ v: 5,...principal,challengeId: challenge.challengeId,challenge: challenge.challenge,purpose: challenge.purpose,resourceHashHex: challenge.resourceHashHex,securityEpoch: 1 }));
const response = (value: unknown,status = 200) => new Response(JSON.stringify(value),{ status });

describe("biometric mobile client",() => {
  const fetchMock = vi.fn();
  const native = { isAvailable: vi.fn(async () => ({ available: true,strong: true,type: "OTHER" as const })),createSigningKey: vi.fn(async () => ({ publicKeySpkiBase64: "public-key",attestation: { certificatesBase64: [] } })),sign: vi.fn(async () => ({ signatureBase64: "signature" })),deleteKey: vi.fn(async () => undefined) };
  beforeEach(() => {
    vi.stubGlobal("fetch",fetchMock); vi.clearAllMocks();
    native.sign.mockResolvedValue({ signatureBase64: "signature" });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/status")) return response({ enrolled: true,keyAlias: "linqa.bio.key" });
      if (url.endsWith("/challenges")) return response({ ...challenge,payloadBase64 });
      if (url.endsWith("/verify")) return response({ grantId: "grant",expiresAt: challenge.expiresAt });
      if (url.endsWith("/private/unlock")) return response({ token: "vault-session",expiresAt: challenge.expiresAt });
      return response({ items: [] });
    });
  });
  const client = (isCurrent = () => true) => new BiometricClient("https://linqa.test",async () => token,async () => principal.installationId,native,isCurrent);
  it("signs the exact server payload and requires server verification before Vault unlock",async () => {
    const session = await client().unlockVault(); expect(session.token).toBe("vault-session");
    expect(native.sign).toHaveBeenCalledWith("linqa.bio.key",payloadBase64,"Unlock LinqaVault");
    const verify = fetchMock.mock.calls.find(call => call[0].endsWith("/verify"))!;
    expect(JSON.parse(verify[1].body)).toEqual({ challengeId: "challenge",challenge: "n".repeat(43),signatureBase64: "signature" });
    expect(verify[1].headers["x-installation-id"]).toBe(principal.installationId);
  });
  it("does not verify or unlock when the user cancels native authentication",async () => {
    native.sign.mockRejectedValueOnce(new Error("Canceled")); await expect(client().unlockVault()).rejects.toThrow("Canceled");
    expect(fetchMock.mock.calls.some(call => call[0].endsWith("/verify") || call[0].endsWith("/private/unlock"))).toBe(false);
  });
  it("rejects a changed signing payload before invoking the hardware key",async () => {
    const previous = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string,init: RequestInit) => url.endsWith("/challenges") ? Promise.resolve(response({ ...challenge,payloadBase64: btoa("tampered") })) : previous(url,init));
    await expect(client().unlockVault()).rejects.toThrow("Invalid or expired biometric challenge"); expect(native.sign).not.toHaveBeenCalled();
  });
  it("rejects a late signature after an account switch",async () => {
    let current = true; native.sign.mockImplementationOnce(async () => { current = false; return { signatureBase64: "signature" }; });
    await expect(client(() => current).unlockVault()).rejects.toThrow("Account changed"); expect(fetchMock.mock.calls.some(call => call[0].endsWith("/verify"))).toBe(false);
  });
  it("fails closed when the native module is absent",async () => {
    const unavailable = new BiometricClient("https://linqa.test",async () => token,async () => principal.installationId,null);
    expect(await unavailable.available()).toMatchObject({ strong: false }); await expect(unavailable.unlockVault()).rejects.toThrow("new native app build");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not expose Private Vault data after session expiry",async () => {
    await expect(client().privateItems({ token: "old",expiresAt: new Date(0).toISOString() })).rejects.toThrow("session expired"); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects server verification failures without unlocking",async () => {
    const previous = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string,init: RequestInit) => url.endsWith("/verify") ? Promise.resolve(response({ error: "BIOMETRIC_SIGNATURE_INVALID" },403)) : previous(url,init));
    await expect(client().unlockVault()).rejects.toThrow("BIOMETRIC_SIGNATURE_INVALID"); expect(fetchMock.mock.calls.some(call => call[0].endsWith("/private/unlock"))).toBe(false);
  });
});
