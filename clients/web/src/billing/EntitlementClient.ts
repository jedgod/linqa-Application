export class EntitlementClient {
  private cache: { expiresAt: number; values: Set<string> } | null = null;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  async has(key: string): Promise<boolean> {
    if (!this.cache || this.cache.expiresAt <= Date.now()) {
      await this.refresh();
    }
    return this.cache?.values.has(key) ?? false;
  }

  async refresh(): Promise<void> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.apiBaseUrl}/v1/entitlements`, {
      headers: { authorization: `Bearer ${token}` }
    });

    if (!response.ok) throw new Error("Unable to load entitlements.");
    const payload = await response.json();

    this.cache = {
      expiresAt: Date.now() + 5 * 60 * 1000,
      values: new Set(
        (payload.entitlements ?? [])
          .filter((item: { enabled: boolean }) => item.enabled)
          .map((item: { key: string }) => item.key)
      )
    };
  }
}
