export interface LocalSyncStore {
  getCursor(): Promise<number>;
  setCursor(cursor: number): Promise<void>;
  applyEncryptedRecord(record: {
    id: string;
    sourceDeviceId: string;
    recordType: string;
    clientRecordId: string;
    ciphertextBase64: string;
    logicalClock: number;
  }): Promise<void>;
}

export class SyncEngine {
  private running = false;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>,
    private readonly store: LocalSyncStore
  ) {}

  async pullOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;

    try {
      const cursor = await this.store.getCursor();
      const token = await this.getAccessToken();

      const response = await fetch(
        `${this.apiBaseUrl}/v1/sync/records?afterClock=${cursor}&limit=100`,
        {
          headers: { authorization: `Bearer ${token}` }
        }
      );

      if (!response.ok) throw new Error("Sync request failed.");
      const payload = await response.json();

      let maxClock = cursor;
      for (const record of payload.records ?? []) {
        await this.store.applyEncryptedRecord(record);
        maxClock = Math.max(maxClock, record.logicalClock);
      }

      if (maxClock > cursor) await this.store.setCursor(maxClock);
      return (payload.records ?? []).length;
    } finally {
      this.running = false;
    }
  }
}
