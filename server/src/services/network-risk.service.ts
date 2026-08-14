import type { Database } from "../db/pool.js";

export interface NetworkObservation {
  userId?: string;
  deviceId?: string;
  isVpn: boolean;
  isProxy: boolean;
  countryCode?: string;
  asn?: string;
  previousCountryCode?: string;
  previousAsn?: string;
  distanceKm?: number;
  elapsedMinutes?: number;
}

export class NetworkRiskService {
  constructor(private readonly db: Database) {}

  async evaluate(input: NetworkObservation): Promise<{
    score: number;
    requireStepUp: boolean;
    forceRelayOnly: boolean;
  }> {
    let score = 0;
    const events: Array<{ type: string; score: number; metadata: object }> = [];

    if (input.isVpn) {
      score += 10;
      events.push({ type: "VPN_DETECTED", score: 10, metadata: {} });
    }
    if (input.isProxy) {
      score += 15;
      events.push({ type: "PROXY_DETECTED", score: 15, metadata: {} });
    }
    if (input.asn && input.previousAsn && input.asn !== input.previousAsn) {
      score += 10;
      events.push({
        type: "ASN_CHANGED",
        score: 10,
        metadata: { previousAsn: input.previousAsn, currentAsn: input.asn }
      });
    }
    if (
      input.countryCode &&
      input.previousCountryCode &&
      input.countryCode !== input.previousCountryCode
    ) {
      score += 20;
      events.push({
        type: "COUNTRY_CHANGED",
        score: 20,
        metadata: {
          previousCountryCode: input.previousCountryCode,
          currentCountryCode: input.countryCode
        }
      });
    }
    if (
      typeof input.distanceKm === "number" &&
      typeof input.elapsedMinutes === "number" &&
      input.distanceKm > 1000 &&
      input.elapsedMinutes < 120
    ) {
      score += 40;
      events.push({
        type: "IMPOSSIBLE_TRAVEL",
        score: 40,
        metadata: {
          distanceKm: input.distanceKm,
          elapsedMinutes: input.elapsedMinutes
        }
      });
    }

    score = Math.min(100, score);

    for (const event of events) {
      await this.db.query(
        `INSERT INTO network_risk_events (
           user_id, device_id, event_type, risk_score, metadata
         ) VALUES ($1,$2,$3,$4,$5)`,
        [
          input.userId ?? null,
          input.deviceId ?? null,
          event.type,
          event.score,
          event.metadata
        ]
      );
    }

    return {
      score,
      requireStepUp: score >= 50,
      forceRelayOnly: input.isVpn || input.isProxy || score >= 30
    };
  }
}
