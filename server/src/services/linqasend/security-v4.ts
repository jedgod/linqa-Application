import { createHash, createPublicKey, randomBytes, randomUUID, verify as verifySignature } from "node:crypto";
import type { Database } from "../../db/pool.js";

export type PaymentRiskDecision = "ALLOW" | "STEP_UP" | "WARN" | "REVIEW" | "HOLD" | "DECLINE" | "FREEZE";
export type DeviceTrustState = "TRUSTED" | "UNKNOWN" | "RISKY" | "REVOKED";

export interface PaymentRiskSignals {
  accountAgeDays: number;
  deviceTrust: DeviceTrustState;
  deviceAgeDays: number;
  recentPasswordReset: boolean;
  recentRecoveryChange: boolean;
  recentPhoneChange: boolean;
  recentDeviceEnrollment: boolean;
  recipientIsNew: boolean;
  priorSuccessfulTransfers: number;
  relationshipAgeDays: number;
  transferCount1h: number;
  transferCount24h: number;
  amountSent24hMinor: bigint;
  amountDeviationRatio: number;
  fundingSourceAgeDays: number;
  fundingSourceReuseAcrossAccounts: number;
  countryMismatch: boolean;
  impossibleTravelSignal: boolean;
  priorChargebacks: number;
  priorFailedFundingAttempts: number;
  quoteAgeSeconds: number;
  blockedRelationship: boolean;
}

export interface PaymentRiskResult {
  score: number;
  decision: PaymentRiskDecision;
  reasons: string[];
  modelVersion: string;
}

export interface SecurityWarning {
  code: string;
  severity: "INFO" | "WARN" | "HIGH" | "CRITICAL";
  messageKey: string;
}

export interface SecurityDecision {
  risk: PaymentRiskResult;
  requireStepUp: boolean;
  requireScamWarning: boolean;
  warnings: SecurityWarning[];
  securityCooldownUntil?: string;
  blocked: boolean;
  blockReason?: string;
}

export interface SecureTransferView {
  id: string;
  senderUserId: string;
  recipientId: string;
  quoteId: string;
  sourceAmountMinor: bigint;
  sourceCurrency: string;
  destinationAmountMinor: bigint;
  destinationCurrency: string;
  fundingSourceId: string;
  transferClass: string;
}

export function deterministicTransferId(userId: string, idempotencyKey: string): string {
  const hex = createHash("sha256").update(`linqasend-v4|${userId}|${idempotencyKey}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  return JSON.stringify(value);
}

export function verifyDevicePaymentAssertion(args: { publicKey: Buffer; nonce: string; transactionHash: string; signatureBase64: string }): boolean {
  const signature = Buffer.from(args.signatureBase64, "base64");
  if (args.publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: args.publicKey.toString("base64url") }, format: "jwk" });
    return verifySignature(null, Buffer.from(`${args.nonce}|${args.transactionHash}`, "utf8"), publicKey, signature);
  } catch { return false; }
}

export class TransactionSignatureService {
  buildTransactionHash(args: SecureTransferView): string {
    const canonical = [
      "LINQASEND_TX_V4",
      args.id,
      args.senderUserId,
      args.recipientId,
      args.quoteId,
      args.sourceAmountMinor.toString(),
      args.sourceCurrency.toUpperCase(),
      args.destinationAmountMinor.toString(),
      args.destinationCurrency.toUpperCase(),
      args.fundingSourceId,
      args.transferClass
    ].join("|");
    return createHash("sha256").update(canonical).digest("hex");
  }
}

export class PaymentRiskEngineV4 {
  readonly modelVersion = "linqasend-risk-v4.1";

  assess(s: PaymentRiskSignals): PaymentRiskResult {
    let score = 0;
    const reasons: string[] = [];
    const add = (condition: boolean, points: number, reason: string) => {
      if (condition) {
        score += points;
        reasons.push(reason);
      }
    };
    add(s.blockedRelationship, 100, "BLOCKED_RELATIONSHIP");
    add(s.deviceTrust === "REVOKED", 100, "REVOKED_DEVICE");
    add(s.deviceTrust === "RISKY", 35, "RISKY_DEVICE");
    add(s.deviceTrust === "UNKNOWN", 15, "UNKNOWN_DEVICE");
    add(s.accountAgeDays < 7, 12, "YOUNG_ACCOUNT");
    add(s.deviceAgeDays < 1, 15, "NEW_DEVICE");
    add(s.recentPasswordReset, 20, "RECENT_PASSWORD_RESET");
    add(s.recentRecoveryChange, 25, "RECENT_RECOVERY_CHANGE");
    add(s.recentPhoneChange, 30, "RECENT_PHONE_CHANGE");
    add(s.recentDeviceEnrollment, 15, "RECENT_DEVICE_ENROLLMENT");
    add(s.recipientIsNew, 12, "NEW_RECIPIENT");
    add(s.priorSuccessfulTransfers === 0 && s.relationshipAgeDays < 1, 12, "NO_ESTABLISHED_RELATIONSHIP");
    add(s.transferCount1h >= 4, 20, "HIGH_VELOCITY_1H");
    add(s.transferCount24h >= 10, 15, "HIGH_VELOCITY_24H");
    add(s.amountDeviationRatio >= 3, 20, "UNUSUAL_AMOUNT");
    add(s.fundingSourceAgeDays < 1, 18, "NEW_FUNDING_SOURCE");
    add(s.fundingSourceReuseAcrossAccounts >= 3, 25, "FUNDING_SOURCE_MULTI_ACCOUNT_REUSE");
    add(s.countryMismatch, 15, "COUNTRY_MISMATCH");
    add(s.impossibleTravelSignal, 35, "IMPOSSIBLE_TRAVEL");
    add(s.priorChargebacks >= 1, 20, "PRIOR_CHARGEBACK");
    add(s.priorFailedFundingAttempts >= 3, 20, "REPEATED_FUNDING_FAILURES");
    add(s.quoteAgeSeconds > 60, 20, "STALE_QUOTE");
    score = Math.min(100, score);
    const decision: PaymentRiskDecision = score >= 90 ? "FREEZE" : score >= 80 ? "DECLINE" : score >= 65 ? "HOLD" : score >= 50 ? "REVIEW" : score >= 30 ? "WARN" : score >= 15 ? "STEP_UP" : "ALLOW";
    return { score, decision, reasons, modelVersion: this.modelVersion };
  }
}

export class ScamDefenseService {
  buildWarnings(risk: PaymentRiskResult): SecurityWarning[] {
    const warnings: SecurityWarning[] = [];
    const has = (reason: string) => risk.reasons.includes(reason);
    if (has("NEW_RECIPIENT")) warnings.push({ code: "NEW_RECIPIENT_WARNING", severity: "WARN", messageKey: "linqasend.scam.new_recipient" });
    if (has("RECENT_PASSWORD_RESET") || has("RECENT_RECOVERY_CHANGE") || has("RECENT_PHONE_CHANGE")) {
      warnings.push({ code: "RECENT_ACCOUNT_SECURITY_CHANGE", severity: "HIGH", messageKey: "linqasend.scam.security_change" });
    }
    if (has("FUNDING_SOURCE_MULTI_ACCOUNT_REUSE")) warnings.push({ code: "FUNDING_SOURCE_REUSE", severity: "HIGH", messageKey: "linqasend.scam.funding_source_reuse" });
    if (has("IMPOSSIBLE_TRAVEL")) warnings.push({ code: "LOCATION_ANOMALY", severity: "CRITICAL", messageKey: "linqasend.scam.location_anomaly" });
    return warnings;
  }
}

function hoursForSecurityEvent(eventType: string): number {
  if (["ACCOUNT_RECOVERY_COMPLETED", "PRIMARY_PHONE_CHANGED", "RECOVERY_PHONE_CHANGED"].includes(eventType)) return 24;
  if (["PASSWORD_RESET", "RECOVERY_EMAIL_CHANGED", "DEVICE_ENROLLED"].includes(eventType)) return 6;
  return 0;
}

export class LinqaSendSecurityV4Service {
  private readonly risk = new PaymentRiskEngineV4();
  private readonly scam = new ScamDefenseService();
  private readonly signatures = new TransactionSignatureService();

  constructor(private readonly db: Database) {}

  async evaluate(args: {
    transfer: SecureTransferView;
    installationId: string;
    deviceId: string;
    signals: Omit<PaymentRiskSignals, "deviceTrust" | "recipientIsNew" | "priorSuccessfulTransfers" | "relationshipAgeDays" | "transferCount1h" | "transferCount24h" | "amountSent24hMinor" | "blockedRelationship">;
  }): Promise<SecurityDecision> {
    const deviceResult = await this.db.query(
      `SELECT trust_state, first_seen_at FROM linqasend_trusted_payment_devices_v4
       WHERE user_id=$1 AND installation_id=$2 AND device_id=$3 ORDER BY last_seen_at DESC LIMIT 1`,
      [args.transfer.senderUserId, args.installationId, args.deviceId]
    );
    const device = deviceResult.rows[0];
    const deviceTrust = (device?.trust_state ?? "UNKNOWN") as DeviceTrustState;
    if (deviceTrust === "REVOKED") return this.persistDecision(args.transfer, { score: 100, decision: "FREEZE", reasons: ["REVOKED_DEVICE"], modelVersion: this.risk.modelVersion }, [], "PAYMENT_DEVICE_REVOKED");

    const recipientResult = await this.db.query(
      `SELECT first_transfer_at, successful_transfer_count, trust_state FROM linqasend_recipient_trust_v4
       WHERE sender_user_id=$1 AND recipient_id=$2`,
      [args.transfer.senderUserId, args.transfer.recipientId]
    );
    const recipient = recipientResult.rows[0];
    const successful = Number(recipient?.successful_transfer_count ?? 0);
    const relationshipAgeDays = recipient?.first_transfer_at ? Math.max(0, Math.floor((Date.now() - new Date(recipient.first_transfer_at).getTime()) / 86_400_000)) : 0;
    const velocity = await this.db.query(
      `SELECT count(*) FILTER (WHERE created_at > now()-interval '1 hour')::int AS count_1h,
              count(*) FILTER (WHERE created_at > now()-interval '24 hours')::int AS count_24h,
              coalesce(sum(send_amount_minor) FILTER (WHERE created_at > now()-interval '24 hours'),0)::bigint AS amount_24h
       FROM linqasend_transfers WHERE user_id=$1`,
      [args.transfer.senderUserId]
    );
    const v = velocity.rows[0];
    const signals: PaymentRiskSignals = {
      ...args.signals,
      deviceTrust,
      recipientIsNew: successful === 0,
      priorSuccessfulTransfers: successful,
      relationshipAgeDays,
      transferCount1h: Number(v?.count_1h ?? 0),
      transferCount24h: Number(v?.count_24h ?? 0),
      amountSent24hMinor: BigInt(v?.amount_24h ?? 0),
      blockedRelationship: recipient?.trust_state === "BLOCKED"
    };
    const result = this.risk.assess(signals);
    const warnings = this.scam.buildWarnings(result);
    const cooldown = await this.activeCooldown(args.transfer.senderUserId);
    const hardBlocked = ["FREEZE", "DECLINE", "HOLD", "REVIEW"].includes(result.decision);
    const blockReason = hardBlocked ? `SECURITY_${result.decision}` : cooldown.active ? "SECURITY_CHANGE_COOLDOWN" : undefined;
    const decision = await this.persistDecision(args.transfer, result, warnings, blockReason, signals);
    return cooldown.until ? { ...decision, securityCooldownUntil: cooldown.until.toISOString() } : decision;
  }

  async createChallenge(args: { transfer: SecureTransferView; installationId: string; deviceId: string }): Promise<{ id: string; nonce: string; transactionHash: string; expiresAt: string }> {
    const transactionHash = this.signatures.buildTransactionHash(args.transfer);
    const nonce = randomBytes(32).toString("base64url");
    const challengeHash = createHash("sha256").update(`${nonce}|${transactionHash}`).digest("hex");
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 120_000);
    await this.db.query(
      `INSERT INTO linqasend_transaction_challenges_v4(id,transfer_id,user_id,challenge_nonce,challenge_hash,expected_transaction_hash,device_id,installation_id,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, args.transfer.id, args.transfer.senderUserId, nonce, challengeHash, transactionHash, args.deviceId, args.installationId, expiresAt]
    );
    return { id, nonce, transactionHash, expiresAt: expiresAt.toISOString() };
  }

  async acknowledgeWarnings(userId: string, transferId: string, codes: string[]): Promise<void> {
    if (codes.length === 0) throw new Error("WARNING_CODES_REQUIRED");
    await this.db.query(
      `UPDATE linqasend_scam_warning_events_v4 SET acknowledged=true, acknowledged_at=now()
       WHERE user_id=$1 AND transfer_id=$2 AND warning_code=ANY($3::text[])`,
      [userId, transferId, codes]
    );
  }

  async authorizeChallenge(args: { challengeId: string; userId: string; deviceId: string; signatureBase64: string }): Promise<{ authorizationId: string; transactionHash: string; expiresAt: string }> {
    const challengeResult = await this.db.query(
      `SELECT c.*,d.signing_public_key,d.status AS device_status FROM linqasend_transaction_challenges_v4 c
       JOIN devices d ON d.id=c.device_id AND d.user_id=c.user_id
       WHERE c.id=$1 AND c.user_id=$2 AND c.device_id=$3 AND c.consumed_at IS NULL AND c.expires_at>now()`,
      [args.challengeId, args.userId, args.deviceId]
    );
    const challenge = challengeResult.rows[0];
    if (!challenge || challenge.device_status !== "ACTIVE") throw new Error("PAYMENT_CHALLENGE_EXPIRED_OR_DEVICE_INVALID");
    if (!verifyDevicePaymentAssertion({ publicKey: Buffer.from(challenge.signing_public_key), nonce: challenge.challenge_nonce, transactionHash: challenge.expected_transaction_hash, signatureBase64: args.signatureBase64 })) throw new Error("PAYMENT_ASSERTION_INVALID");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const consumed = await client.query(`UPDATE linqasend_transaction_challenges_v4 SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING id`, [args.challengeId]);
      if (!consumed.rowCount) throw new Error("PAYMENT_CHALLENGE_USED_OR_EXPIRED");
      const authorizationId = randomUUID(), expiresAt = new Date(Date.now() + 120_000);
      await client.query(`INSERT INTO linqasend_transaction_authorizations_v4(id,transfer_id,user_id,jti,transaction_hash,device_binding_key_id,auth_method,expires_at) VALUES($1,$2,$3,$4,$5,$6,'DEVICE_CREDENTIAL',$7)`, [authorizationId, challenge.transfer_id, args.userId, randomUUID(), challenge.expected_transaction_hash, args.deviceId, expiresAt]);
      await client.query(`UPDATE linqasend_trusted_payment_devices_v4 SET trust_state='TRUSTED',last_step_up_at=now(),last_seen_at=now() WHERE user_id=$1 AND installation_id=$2 AND device_id=$3 AND trust_state<>'REVOKED'`, [args.userId, challenge.installation_id, args.deviceId]);
      await client.query("COMMIT");
      await this.appendAudit("USER", args.userId, challenge.transfer_id, "TRANSACTION_AUTHORIZED", { authorizationId, transactionHash: challenge.expected_transaction_hash, deviceId: args.deviceId });
      return { authorizationId, transactionHash: challenge.expected_transaction_hash, expiresAt: expiresAt.toISOString() };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async consumeAuthorization(args: { authorizationId: string; userId: string; transferId: string; transactionHash: string; deviceId: string }): Promise<void> {
    const result = await this.db.query(
      `UPDATE linqasend_transaction_authorizations_v4 SET consumed_at=now()
       WHERE id=$1 AND user_id=$2 AND transfer_id=$3 AND transaction_hash=$4 AND device_binding_key_id=$5
         AND consumed_at IS NULL AND expires_at>now() RETURNING id`,
      [args.authorizationId, args.userId, args.transferId, args.transactionHash, args.deviceId]
    );
    if (!result.rowCount) throw new Error("PAYMENT_AUTHORIZATION_USED_EXPIRED_OR_MISMATCHED");
  }

  private async activeCooldown(userId: string): Promise<{ active: boolean; until?: Date }> {
    const { rows } = await this.db.query(
      `SELECT event_type,event_at FROM linqasend_security_change_events_v4
       WHERE user_id=$1 AND event_at > now()-interval '72 hours' ORDER BY event_at DESC`,
      [userId]
    );
    let until: Date | undefined;
    for (const row of rows) {
      const hours = hoursForSecurityEvent(row.event_type);
      const candidate = new Date(new Date(row.event_at).getTime() + hours * 3_600_000);
      if (hours > 0 && (!until || candidate > until)) until = candidate;
    }
    return until ? { active: until > new Date(), until } : { active: false };
  }

  private async persistDecision(
    transfer: SecureTransferView,
    risk: PaymentRiskResult,
    warnings: SecurityWarning[],
    blockReason?: string,
    signals?: PaymentRiskSignals
  ): Promise<SecurityDecision> {
    await this.db.query(
      `INSERT INTO linqasend_payment_risk_assessments_v4(transfer_id,user_id,score,decision,model_version,reasons,signals)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [transfer.id, transfer.senderUserId, risk.score, risk.decision, risk.modelVersion, JSON.stringify(risk.reasons), JSON.stringify(signals ?? {}, (_key, value) => (typeof value === "bigint" ? value.toString() : value))]
    );
    for (const warning of warnings) {
      await this.db.query(
        `INSERT INTO linqasend_scam_warning_events_v4(transfer_id,user_id,warning_code,severity,displayed_at) VALUES($1,$2,$3,$4,now())`,
        [transfer.id, transfer.senderUserId, warning.code, warning.severity]
      );
    }
    await this.appendAudit("SYSTEM", "linqasend-risk-v4.1", transfer.id, "PAYMENT_RISK_DECISION", { score: risk.score, decision: risk.decision, reasons: risk.reasons, warnings: warnings.map((warning) => warning.code), blockReason: blockReason ?? null });
    const blocked = Boolean(blockReason);
    return {
      risk,
      requireStepUp: true,
      requireScamWarning: warnings.length > 0,
      warnings,
      blocked,
      ...(blockReason ? { blockReason } : {})
    };
  }

  private async appendAudit(actorType: string, actorId: string, transferId: string, eventType: string, evidence: Record<string, unknown>): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('linqasend-security-audit-v4'))`);
      const prior = await client.query(`SELECT event_hash FROM linqasend_security_audit_v4 ORDER BY created_at DESC,id DESC LIMIT 1`);
      const previousHash = prior.rows[0]?.event_hash ?? null;
      const eventHash = createHash("sha256").update(canonicalJson({ actorType, actorId, transferId, eventType, evidence, previousHash })).digest("hex");
      await client.query(`INSERT INTO linqasend_security_audit_v4(actor_type,actor_id,transfer_id,event_type,evidence,prev_event_hash,event_hash) VALUES($1,$2,$3,$4,$5,$6,$7)`, [actorType, actorId, transferId, eventType, JSON.stringify(evidence), previousHash, eventHash]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
