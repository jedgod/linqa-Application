export interface MlsProvider {
  createGroup(input: unknown): Promise<unknown>;
  processCommit(input: unknown): Promise<unknown>;
  encryptApplicationMessage(input: unknown): Promise<Uint8Array>;
  decryptApplicationMessage(input: unknown): Promise<Uint8Array>;
}

export class FailClosedMlsProvider implements MlsProvider {
  async createGroup(): Promise<never> {
    throw new Error("MLS provider is not configured.");
  }
  async processCommit(): Promise<never> {
    throw new Error("MLS provider is not configured.");
  }
  async encryptApplicationMessage(): Promise<never> {
    throw new Error("MLS provider is not configured.");
  }
  async decryptApplicationMessage(): Promise<never> {
    throw new Error("MLS provider is not configured.");
  }
}