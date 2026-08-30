import { createHash } from "node:crypto";
import type { Database } from "../../db/pool.js";

export interface AuthoritativeFraudSignals {
  accountAgeDays: number;
  deviceAgeDays: number;
  recentPasswordReset: boolean;
  recentRecoveryChange: boolean;
  recentPhoneChange: boolean;
  recentDeviceEnrollment: boolean;
  recentSimChange: boolean;
  amountDeviationRatio: number;
  fundingSourceAgeDays: number;
  fundingSourceReuseAcrossAccounts: number;
  countryMismatch: boolean;
  impossibleTravelSignal: boolean;
  priorChargebacks: number;
  priorFailedFundingAttempts: number;
  quoteAgeSeconds: number;
  velocity24hMinor: bigint;
  deviceTrusted: boolean;
  countryRiskScore: number;
}

export interface CollectedFraudSnapshot {
  signals: AuthoritativeFraudSignals;
  sourceTimestamps: Record<string, string>;
  snapshotHash: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Reads every fraud input from an authoritative persisted source. */
export class AuthoritativeFraudSignalsService {
  constructor(private readonly db: Database, private readonly maxAgeSeconds = 900) {}

  async collect(args: { userId: string; deviceId: string; installationId: string; paymentMethodId: string; sourceCountry: string; amountMinor: bigint; quoteCreatedAt: Date | string }): Promise<CollectedFraudSnapshot> {
    const [account, device, funding, security, history, failed, chargebacks, location, travel, countryRisk, reuse] = await Promise.all([
      this.db.query(`SELECT created_at FROM users WHERE id=$1 AND status='ACTIVE'`, [args.userId]),
      this.db.query(`SELECT first_seen_at,last_seen_at,trust_state FROM linqasend_trusted_payment_devices_v4 WHERE user_id=$1 AND installation_id=$2 AND device_id=$3 ORDER BY last_seen_at DESC LIMIT 1`, [args.userId, args.installationId, args.deviceId]),
      this.db.query(`SELECT created_at FROM linqasend_payment_methods WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`, [args.paymentMethodId, args.userId]),
      this.db.query(`SELECT max(event_at) FILTER (WHERE event_type='PASSWORD_RESET') AS password_at,max(event_at) FILTER (WHERE event_type IN ('ACCOUNT_RECOVERY_COMPLETED','RECOVERY_EMAIL_CHANGED','RECOVERY_PHONE_CHANGED')) AS recovery_at,max(event_at) FILTER (WHERE event_type IN ('PRIMARY_PHONE_CHANGED','RECOVERY_PHONE_CHANGED')) AS phone_at,max(event_at) FILTER (WHERE event_type='DEVICE_ENROLLED') AS device_at,max(event_at) FILTER (WHERE event_type IN ('SIM_CHANGED','SIM_SWAP_DETECTED')) AS sim_at FROM linqasend_security_change_events_v4 WHERE user_id=$1`, [args.userId]),
      this.db.query(`SELECT count(*)::int AS count,coalesce(avg(send_amount_minor),0)::numeric AS average,coalesce(sum(send_amount_minor) FILTER(WHERE created_at>now()-interval '24 hours'),0)::bigint AS velocity,max(created_at) AS observed_at FROM linqasend_transfers WHERE user_id=$1`, [args.userId]),
      this.db.query(`SELECT count(*)::int AS count,max(a.created_at) AS observed_at FROM linqasend_transfer_attempts a JOIN linqasend_transfers t ON t.id=a.transfer_id WHERE t.user_id=$1 AND a.phase='FUNDING_AUTHORIZATION' AND a.status IN ('DECLINED','FAILED')`, [args.userId]),
      this.db.query(`SELECT count(*)::int AS count,max(m.created_at) AS observed_at FROM linqasend_money_adjustments_v5 m JOIN linqasend_transfers t ON t.id=m.transfer_id WHERE t.user_id=$1 AND m.adjustment_type='CHARGEBACK'`, [args.userId]),
      this.db.query(`SELECT country,observed_at FROM user_location_observations_v2 WHERE user_id=$1 AND confidence>=0.8 AND observed_at>now()-interval '24 hours' ORDER BY observed_at DESC LIMIT 1`, [args.userId]),
      this.db.query(`SELECT count(*)::int AS count,max(a.observed_at) AS observed_at FROM user_location_observations_v2 a JOIN user_location_observations_v2 b ON b.user_id=a.user_id AND b.id<>a.id AND b.country<>a.country AND abs(extract(epoch from (a.observed_at-b.observed_at)))<7200 WHERE a.user_id=$1 AND a.confidence>=0.8 AND b.confidence>=0.8 AND a.observed_at>now()-interval '24 hours'`, [args.userId]),
      this.db.query(`SELECT risk_score,observed_at,expires_at FROM linqasend_country_risk_signals WHERE country=$1 AND observed_at>now()-($2::text||' seconds')::interval AND expires_at>now()`, [args.sourceCountry, this.maxAgeSeconds]),
      this.db.query(`SELECT count(DISTINCT owner_user_id)::int AS owners,max(last_seen_at) AS observed_at FROM linqasend_funding_fingerprints_v4 WHERE funding_source_id=$1`, [args.paymentMethodId])
    ]);

    const missing: string[] = [];
    if (!account.rows[0]) missing.push("account_age");
    if (!device.rows[0]) missing.push("payment_device_trust");
    if (!funding.rows[0]) missing.push("funding_source_age");
    if (!location.rows[0]) missing.push("location_consistency");
    if (!countryRisk.rows[0]) missing.push("country_risk");
    if (!reuse.rows[0]?.observed_at) missing.push("funding_source_fingerprint");
    if (missing.length) throw new Error(`AUTHORITATIVE_FRAUD_SIGNALS_MISSING:${missing.join(",")}`);

    const now = Date.now();
    const ageDays = (value: unknown) => Math.max(0, Math.floor((now - new Date(value as string).getTime()) / 86_400_000));
    const withinHours = (value: unknown, hours: number) => Boolean(value && now - new Date(value as string).getTime() <= hours * 3_600_000);
    const s = security.rows[0] ?? {};
    const h = history.rows[0] ?? {};
    const average = Number(h.average ?? 0);
    const signals: AuthoritativeFraudSignals = {
      accountAgeDays: ageDays(account.rows[0].created_at), deviceAgeDays: ageDays(device.rows[0].first_seen_at),
      recentPasswordReset: withinHours(s.password_at, 24), recentRecoveryChange: withinHours(s.recovery_at, 72),
      recentPhoneChange: withinHours(s.phone_at, 72), recentDeviceEnrollment: withinHours(s.device_at, 24), recentSimChange: withinHours(s.sim_at, 72),
      amountDeviationRatio: average > 0 ? Number(args.amountMinor) / average : 1,
      fundingSourceAgeDays: ageDays(funding.rows[0].created_at), fundingSourceReuseAcrossAccounts: Math.max(0, Number(reuse.rows[0].owners) - 1),
      countryMismatch: location.rows[0].country !== args.sourceCountry, impossibleTravelSignal: Number(travel.rows[0]?.count ?? 0) > 0,
      priorChargebacks: Number(chargebacks.rows[0]?.count ?? 0), priorFailedFundingAttempts: Number(failed.rows[0]?.count ?? 0),
      quoteAgeSeconds: Math.max(0, Math.floor((now - new Date(args.quoteCreatedAt).getTime()) / 1000)),
      velocity24hMinor: BigInt(h.velocity ?? 0), deviceTrusted: device.rows[0].trust_state === "TRUSTED",
      countryRiskScore: Number(countryRisk.rows[0].risk_score)
    };
    const observedNow = new Date().toISOString();
    const sourceTimestamps = {
      account: new Date(account.rows[0].created_at).toISOString(), device: new Date(device.rows[0].last_seen_at).toISOString(),
      funding: new Date(funding.rows[0].created_at).toISOString(), security_events: observedNow,
      transfer_history: h.observed_at ? new Date(h.observed_at).toISOString() : observedNow,
      failed_funding: failed.rows[0]?.observed_at ? new Date(failed.rows[0].observed_at).toISOString() : observedNow,
      chargebacks: chargebacks.rows[0]?.observed_at ? new Date(chargebacks.rows[0].observed_at).toISOString() : observedNow,
      location: new Date(location.rows[0].observed_at).toISOString(), travel: travel.rows[0]?.observed_at ? new Date(travel.rows[0].observed_at).toISOString() : observedNow,
      country_risk: new Date(countryRisk.rows[0].observed_at).toISOString(), funding_fingerprint: new Date(reuse.rows[0].observed_at).toISOString()
    };
    const serializableSignals = { ...signals, velocity24hMinor: signals.velocity24hMinor.toString() };
    return { signals, sourceTimestamps, snapshotHash: createHash("sha256").update(canonical({ signals: serializableSignals, sourceTimestamps })).digest("hex") };
  }

  async persist(args: { transferId: string; authorizationId: string; userId: string; deviceId: string; snapshot: CollectedFraudSnapshot }): Promise<string> {
    const result = await this.db.query(`INSERT INTO linqasend_fraud_signal_snapshots(transfer_id,authorization_id,user_id,device_id,signals,source_timestamps,snapshot_hash,complete,stale) VALUES($1,$2,$3,$4,$5,$6,$7,true,false) RETURNING id`, [args.transferId,args.authorizationId,args.userId,args.deviceId,JSON.stringify({ ...args.snapshot.signals, velocity24hMinor: args.snapshot.signals.velocity24hMinor.toString() }),JSON.stringify(args.snapshot.sourceTimestamps),args.snapshot.snapshotHash]);
    const id = result.rows[0].id as string;
    await this.db.query(`UPDATE linqasend_transfers SET fraud_signal_snapshot_id=$2 WHERE id=$1`, [args.transferId,id]);
    return id;
  }
}
