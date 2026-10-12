import type { CallSession } from '../ports';
import { b64d } from './bytes';
import type { DevicePublicKeys, KeyDirectory } from './linqaCore';

/**
 * Reads device public keys from the Linqa API's existing key directory.
 * Adjust `path` and `parse` to match the endpoint linqa-core already
 * publishes keys to. Expected JSON per device:
 *   { deviceId, x25519, mlkem768, ed25519 }   (base64)
 *
 * Signing keys are cached for the session. If your directory supports
 * key-transparency or safety numbers, check them in `parse`.
 */
export class HttpKeyDirectory implements KeyDirectory {
  private cache = new Map<string, { at: number; devices: DevicePublicKeys[] }>();

  constructor(
    private readonly session: CallSession,
    private readonly path = (userId: string) => `/keys/users/${encodeURIComponent(userId)}/devices`,
    private readonly ttlMs = 60_000,
  ) {}

  async devices(userId: string): Promise<DevicePublicKeys[]> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.devices;
    const res = await fetch(`${this.session.apiBaseUrl}${this.path(userId)}`, {
      headers: { Authorization: `Bearer ${await this.session.getToken()}`, 'X-Device-Id': this.session.deviceId },
    });
    if (!res.ok) throw new Error(`key-directory-${res.status}`);
    const json = await res.json();
    const list: any[] = Array.isArray(json) ? json : json.devices ?? [];
    const devices = list.map((d) => this.parse(userId, d)).filter((d): d is DevicePublicKeys => d !== null);
    this.cache.set(userId, { at: Date.now(), devices });
    return devices;
  }

  async device(userId: string, deviceId: string): Promise<DevicePublicKeys | null> {
    const find = (l: DevicePublicKeys[]) => l.find((d) => d.deviceId === deviceId) ?? null;
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.at < this.ttlMs) {
      const d = find(cached.devices);
      if (d) return d;
    }
    this.cache.delete(userId);
    return find(await this.devices(userId));
  }

  private parse(userId: string, d: any): DevicePublicKeys | null {
    try {
      const keys = {
        userId,
        deviceId: String(d.deviceId ?? d.id),
        x25519: b64d(d.x25519),
        mlkem768: b64d(d.mlkem768 ?? d.mlKem768),
        ed25519: b64d(d.ed25519),
      };
      if (keys.x25519.length !== 32 || keys.ed25519.length !== 32 || keys.mlkem768.length !== 1184) return null;
      return keys;
    } catch {
      return null;
    }
  }
}
