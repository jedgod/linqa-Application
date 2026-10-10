import { requireOptionalNativeModule } from "expo-modules-core";

/** The native bridge to the Rust secure core. Null when this build does not include it (the conversation then stays sealed). */
export type SecureCoreModule = {
  createCore(keyMaterialB64: string | null): Promise<boolean>;
  destroyCore(): Promise<boolean>;
  version(): Promise<string>;
  protectionLevel(): Promise<"SOFTWARE_REQUIRES_OS_WRAPPING" | "OS_PROTECTED" | "HARDWARE_BACKED">;
  exportKeyMaterial(): Promise<string>;
  generateKeyPackage(userId: string, deviceId: string, expiresAtMs: number): Promise<string>;
  verifyKeyPackage(packageB64: string): Promise<boolean>;
  encryptMessage(requestJson: string): Promise<string>;
  decryptMessage(envelopeB64: string): Promise<string>;
  verifyTransparencyProof(proofB64: string): Promise<boolean>;
};

export function secureCoreModule(): SecureCoreModule | null {
  try { return requireOptionalNativeModule<SecureCoreModule>("LinqaSecureCore"); } catch { return null; }
}
