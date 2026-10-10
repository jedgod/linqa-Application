import { requireOptionalNativeModule } from "expo-modules-core";
export type BiometricSigningModule = {
  isAvailable(): Promise<{ available: boolean; strong: boolean; type: "FACE" | "FINGERPRINT" | "OTHER" | "NONE" }>;
  createSigningKey(alias: string, nonceBase64: string): Promise<{ publicKeySpkiBase64: string; attestation: unknown }>;
  sign(alias: string,payloadBase64: string,prompt: string): Promise<{ signatureBase64: string }>;
  deleteKey(alias: string): Promise<void>;
};
export function biometricSigningModule(): BiometricSigningModule | null {
  try { return requireOptionalNativeModule<BiometricSigningModule>("LinqaBiometric"); } catch { return null; }
}
