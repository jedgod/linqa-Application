export interface NativeCoreRuntime {
  apiVersion: number;
  protocolVersion: number;
  buildVersion: string;
  secureCoreReady: boolean;
}

export interface NativeCoreBinding {
  runtimeInfo(): Promise<NativeCoreRuntime>;
  encryptMessage(request: unknown): Promise<Uint8Array>;
  decryptMessage(envelope: Uint8Array): Promise<Uint8Array>;
  deriveSafetyNumber(input: {
    localUserId: string;
    localIdentityKey: Uint8Array;
    remoteUserId: string;
    remoteIdentityKey: Uint8Array;
  }): Promise<string>;
}

export class SecureCoreAdapter {
  constructor(private readonly binding: NativeCoreBinding) {}

  async assertReady(expectedApiVersion = 1): Promise<NativeCoreRuntime> {
    const runtime = await this.binding.runtimeInfo();

    if (!runtime.secureCoreReady) {
      throw new Error("Secure core is not ready.");
    }
    if (runtime.apiVersion !== expectedApiVersion) {
      throw new Error(
        `Secure core API mismatch: expected ${expectedApiVersion}, received ${runtime.apiVersion}.`
      );
    }
    return runtime;
  }

  async encrypt(request: unknown): Promise<Uint8Array> {
    await this.assertReady();
    const output = await this.binding.encryptMessage(request);
    if (output.byteLength < 32) {
      throw new Error("Secure core returned an invalid ciphertext.");
    }
    return output;
  }
}
