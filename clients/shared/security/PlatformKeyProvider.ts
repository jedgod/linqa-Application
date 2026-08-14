export interface PlatformKeyProvider {
  createWrappingKey(alias: string): Promise<void>;
  wrapKey(input: { alias: string; rawKey: Uint8Array; context: Uint8Array }): Promise<Uint8Array>;
  unwrapKey(input: { alias: string; wrappedKey: Uint8Array; context: Uint8Array }): Promise<Uint8Array>;
  deleteKey(alias: string): Promise<void>;
  supportsHardwareBackedKeys(): Promise<boolean>;
}

export class FailClosedPlatformKeyProvider implements PlatformKeyProvider {
  async createWrappingKey(): Promise<never> { throw new Error("Platform key provider not configured."); }
  async wrapKey(): Promise<never> { throw new Error("Platform key provider not configured."); }
  async unwrapKey(): Promise<never> { throw new Error("Platform key provider not configured."); }
  async deleteKey(): Promise<never> { throw new Error("Platform key provider not configured."); }
  async supportsHardwareBackedKeys(): Promise<boolean> { return false; }
}