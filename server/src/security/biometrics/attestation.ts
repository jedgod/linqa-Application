import { createHash } from "node:crypto";
import type { AppConfig } from "../../config.js";
import { unavailableAttestation, type BiometricAttestationVerifier } from "./service.js";

/** Provider must validate platform evidence, nonce, app identity, key and auth-per-use policy. */
export function biometricAttestation(config: AppConfig): BiometricAttestationVerifier {
  const url = config.BIOMETRIC_ATTESTATION_URL, token = config.BIOMETRIC_ATTESTATION_TOKEN;
  if (!url || !token) return unavailableAttestation;
  if (config.NODE_ENV === "production" && new URL(url).protocol !== "https:") throw new Error("BIOMETRIC_ATTESTATION_HTTPS_REQUIRED");
  return { verify: async input => {
    const publicKeyHash = createHash("sha256").update(Buffer.from(input.publicKeySpkiBase64,"base64")).digest("hex");
    const response = await fetch(url,{ method: "POST",headers: { authorization: `Bearer ${token}`,"content-type": "application/json" },body: JSON.stringify({ ...input,publicKeyHash }),signal: AbortSignal.timeout(5000),redirect: "error" });
    if (!response.ok) throw new Error("BIOMETRIC_ATTESTATION_UNAVAILABLE");
    const result = await response.json() as Record<string, unknown>;
    const verified = result.verified === true && result.publicKeyHash === publicKeyHash && result.nonce === input.nonce && result.userId === input.principal.userId && result.deviceId === input.principal.deviceId && result.installationId === input.principal.installationId && result.sessionId === input.principal.sessionId && result.biometricStrong === true && result.hardwareBacked === true && result.authPerUse === true;
    return { verified,provider: typeof result.provider === "string" ? result.provider.slice(0,100) : "UNVERIFIED" };
  } };
}
