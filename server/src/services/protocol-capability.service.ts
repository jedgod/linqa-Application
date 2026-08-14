import type { Database } from "../db/pool.js";

export class ProtocolCapabilityService {
  constructor(private readonly db: Database) {}

  async publish(input: {
    deviceId: string;
    protocolMin: number;
    protocolMax: number;
    capabilities: Record<string, boolean | number | string>;
    coreVersion: string;
  }) {
    if (input.protocolMin < 1 || input.protocolMax < input.protocolMin) {
      throw new Error("invalid protocol range");
    }

    await this.db.query(
      `INSERT INTO protocol_capabilities (
         device_id, protocol_min, protocol_max, capabilities, core_version
       ) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (device_id)
       DO UPDATE SET
         protocol_min = EXCLUDED.protocol_min,
         protocol_max = EXCLUDED.protocol_max,
         capabilities = EXCLUDED.capabilities,
         core_version = EXCLUDED.core_version,
         updated_at = now()`,
      [
        input.deviceId,
        input.protocolMin,
        input.protocolMax,
        input.capabilities,
        input.coreVersion
      ]
    );
  }

  negotiate(local: { min: number; max: number }, remote: { min: number; max: number }) {
    const selected = Math.min(local.max, remote.max);
    if (selected < Math.max(local.min, remote.min)) {
      throw new Error("no compatible protocol version");
    }
    return selected;
  }
}
