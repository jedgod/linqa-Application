import type { PeerDirectory, SecureCoreDevice, SecretStore } from "./secure-core";

/** The server calls the secure core needs: other people's published key packages, and publishing this device's own. */
export class SecureCoreServer implements PeerDirectory {
  private readonly cache = new Map<string, { at: number; list: Array<{ deviceId: string; packageBase64: string }> }>();
  constructor(private readonly baseUrl: string, private readonly getAccessToken: () => Promise<string>, private readonly now: () => number = Date.now) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${await this.getAccessToken()}`, ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...(init.headers ?? {}) } });
    } catch { throw new Error("NETWORK"); }
    const body = (await response.text().catch(() => "")) || "{}";
    let data: unknown = {};
    try { data = JSON.parse(body); } catch { /* not JSON */ }
    if (!response.ok) {
      const e = (data as { error?: unknown }).error;
      throw new Error(typeof e === "string" ? e : `HTTP_${response.status}`);
    }
    return data as T;
  }

  /** A person's active devices' key packages. Kept for a minute so a burst of messages asks once. */
  async keyPackages(userId: string): Promise<Array<{ deviceId: string; packageBase64: string }>> {
    const hit = this.cache.get(userId);
    if (hit && this.now() - hit.at < 60_000) return hit.list;
    const { keyPackages } = await this.request<{ keyPackages: Array<{ deviceId: string; packageBase64: string }> }>(`/v1/users/${encodeURIComponent(userId)}/key-packages`);
    const list = keyPackages.map((k) => ({ deviceId: k.deviceId, packageBase64: k.packageBase64 }));
    this.cache.set(userId, { at: this.now(), list });
    return list;
  }

  forget(userId: string) { this.cache.delete(userId); }

  /**
   * Publishes this device's key package unless a valid one is already out there (more than three days left). Returns what
   * happened, so the caller can say so; it throws when the server refuses.
   */
  async publishKeyPackage(device: SecureCoreDevice, store: SecretStore): Promise<"PUBLISHED" | "CURRENT"> {
    const until = Number(await store.get("device.keyPackageUntil"));
    if (Number.isFinite(until) && until - this.now() > 3 * 86_400_000) return "CURRENT";
    const made = await device.createKeyPackage();
    await this.request(`/v1/devices/${encodeURIComponent(await device.deviceId())}/key-package`, { method: "PUT", body: JSON.stringify(made) });
    await store.put("device.keyPackageUntil", String(Date.parse(made.expiresAt)));
    this.forget(device.userId);
    return "PUBLISHED";
  }
}
