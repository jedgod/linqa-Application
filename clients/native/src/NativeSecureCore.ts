export interface NativeSecureCore {
  version(): Promise<string>;
  protectionLevel(): Promise<"SOFTWARE_REQUIRES_OS_WRAPPING" | "OS_PROTECTED" | "HARDWARE_BACKED">;
  exportKeyMaterial(): Promise<string>;
  generateKeyPackage(userId: string, deviceId: string, expiresAt: number): Promise<string>;
  verifyKeyPackage(packageB64: string): Promise<void>;
  encryptMessage(requestJson: string): Promise<string>;
  decryptMessage(requestB64: string): Promise<string>;
  verifyTransparencyProof(proofB64: string): Promise<void>;
}

export interface NativeKeyCustody {
  loadOrCreateCore(accountId: string): Promise<{ core: NativeSecureCore; protectionLevel: "OS_PROTECTED" | "HARDWARE_BACKED" }>;
  destroy(accountId: string): Promise<void>;
}
