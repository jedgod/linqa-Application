export interface NativeSecureCore {
  version(): Promise<string>;
  protectionLevel(): Promise<"SOFTWARE_REQUIRES_OS_WRAPPING" | "OS_PROTECTED" | "HARDWARE_BACKED">;
  exportKeyMaterial(): Promise<string>;
  generateKeyPackage(userId: string, deviceId: string, expiresAt: number): Promise<string>;
  verifyKeyPackage(packageB64: string): Promise<void>;
  encryptMessage(requestJson: string): Promise<string>;
  decryptMessage(envelopeB64: string): Promise<string>;
  verifyTransparencyProof(proofB64: string): Promise<void>;
}

export function requireNativeSecureCore(module: NativeSecureCore | undefined): NativeSecureCore {
  if (!module) throw new Error("NATIVE_SECURE_CORE_UNAVAILABLE");
  return module;
}
