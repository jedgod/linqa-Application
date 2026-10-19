import { createHash, createPublicKey, verify } from "node:crypto";

export const purposes = ["VAULT_UNLOCK", "VAULT_PRIVATE_OPEN", "VAULT_EXPORT_SOCIAL", "VAULT_DELETE_PERMANENT", "VAULT_SHARE_EXTERNAL", "SEND_TRANSFER_AUTHORIZE", "SEND_CASHOUT_AUTHORIZE", "SEND_WALLET_AUTHORIZE", "SEND_ADD_PAYMENT_METHOD", "SEND_CHANGE_SECURITY"] as const;
export type BiometricPurpose = typeof purposes[number];
export type BiometricPrincipal = { userId: string; deviceId: string; sessionId: string; installationId: string };

/** v5 wire format: deterministic JSON, rejecting ambiguous or lossy values. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  throw new Error("INVALID_BIOMETRIC_RESOURCE");
}
export const hashResource = (value: unknown) => createHash("sha256").update(canonical(value)).digest();
export function signingPayload(value: BiometricPrincipal & { challengeId: string; challenge: string; purpose: BiometricPurpose; resourceHashHex: string; securityEpoch: number }) { return Buffer.from(canonical({ v: 5, ...value }), "utf8"); }
export function p256Key(spki: Buffer) {
  if (spki.length > 256) throw new Error("INVALID_BIOMETRIC_KEY");
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("INVALID_BIOMETRIC_KEY");
  return key;
}
export function verifyP256(spki: Buffer, payload: Buffer, signature: Buffer) { try { return signature.length >= 8 && signature.length <= 80 && verify("sha256", payload, p256Key(spki), signature); } catch { return false; } }
