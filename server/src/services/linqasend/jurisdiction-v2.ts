import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool.js";

export enum LocationRelationship {
  HOME = "HOME", TRAVELING = "TRAVELING", TEMPORARY_RESIDENT = "TEMPORARY_RESIDENT",
  RELOCATION_PENDING = "RELOCATION_PENDING", RELOCATION_VERIFICATION = "RELOCATION_VERIFICATION",
  RELOCATED_VERIFIED = "RELOCATED_VERIFIED", LOCATION_MISMATCH = "LOCATION_MISMATCH", LOCATION_HIGH_RISK = "LOCATION_HIGH_RISK"
}
export enum JurisdictionMigrationStatus {
  NONE = "NONE", REQUESTED = "REQUESTED", DOCUMENTS_REQUIRED = "DOCUMENTS_REQUIRED", UNDER_REVIEW = "UNDER_REVIEW",
  APPROVED_FOR_MIGRATION = "APPROVED_FOR_MIGRATION", APPROVED = "APPROVED", REJECTED = "REJECTED", SUSPENDED = "SUSPENDED", CANCELLED = "CANCELLED"
}
export enum LocationSignalType { IP = "IP", GPS = "GPS", SIM = "SIM", PHONE_PREFIX = "PHONE_PREFIX", DEVICE_LOCALE = "DEVICE_LOCALE", TIMEZONE = "TIMEZONE", BANK_COUNTRY = "BANK_COUNTRY", CARD_COUNTRY = "CARD_COUNTRY", VERIFIED_ADDRESS = "VERIFIED_ADDRESS" }
export enum LocationRiskSignal { IMPOSSIBLE_TRAVEL = "IMPOSSIBLE_TRAVEL", VPN_OR_PROXY = "VPN_OR_PROXY", TOR_EXIT_NODE = "TOR_EXIT_NODE", SIM_COUNTRY_CHANGE = "SIM_COUNTRY_CHANGE", NEW_DEVICE = "NEW_DEVICE", COUNTRY_MISMATCH = "COUNTRY_MISMATCH", RAPID_COUNTRY_HOPPING = "RAPID_COUNTRY_HOPPING", SESSION_TAKEOVER_RISK = "SESSION_TAKEOVER_RISK", SPOOFED_LOCATION_SUSPECTED = "SPOOFED_LOCATION_SUSPECTED" }
export enum SensitiveAction { P2P_SEND = "P2P_SEND", STANDARD_CASHOUT = "STANDARD_CASHOUT", INSTANT_CASHOUT = "INSTANT_CASHOUT", BANK_ACCOUNT_ADD = "BANK_ACCOUNT_ADD", BANK_ACCOUNT_CHANGE = "BANK_ACCOUNT_CHANGE", DEBIT_CARD_ADD = "DEBIT_CARD_ADD", DEBIT_CARD_CHANGE = "DEBIT_CARD_CHANGE", RELOCATION_REQUEST = "RELOCATION_REQUEST", RELOCATION_EVIDENCE_UPLOAD = "RELOCATION_EVIDENCE_UPLOAD", RELOCATION_APPROVAL = "RELOCATION_APPROVAL", WALLET_MIGRATION = "WALLET_MIGRATION", FX_TRANSFER = "FX_TRANSFER", PHONE_CHANGE = "PHONE_CHANGE", RECOVERY_EMAIL_CHANGE = "RECOVERY_EMAIL_CHANGE" }
export enum AuthorizationOutcome { ALLOW = "ALLOW", STEP_UP = "STEP_UP", TEMPORARY_HOLD = "TEMPORARY_HOLD", BLOCK = "BLOCK" }
export enum TravelTransactionPolicy { NORMAL = "NORMAL", STEP_UP_REQUIRED = "STEP_UP_REQUIRED", RESTRICT_HIGH_RISK_ACTIONS = "RESTRICT_HIGH_RISK_ACTIONS", TEMPORARY_HOLD = "TEMPORARY_HOLD" }

export interface UserJurisdictionProfile {
  userId: string; originalRegistrationCountry: string; verifiedResidenceCountry: string; accountCountry: string;
  currentPhysicalCountry: string | null; regulatoryEntityId: string; regulatoryJurisdiction: string;
  locationRelationship: LocationRelationship; migrationStatus: JurisdictionMigrationStatus; jurisdictionVersion: number;
}
export interface LocationSignal { type: LocationSignalType; country: string | null; confidence: number; observedAt: Date; metadata?: Record<string, unknown> }
export interface LocationAssessment { currentPhysicalCountry: string | null; locationRelationship: LocationRelationship; riskSignals: LocationRiskSignal[]; requiresStepUpAuth: boolean; jurisdictionChanged: false }

export class LocationIntelligenceEngine {
  assess(args: {
    profile: UserJurisdictionProfile; signals: LocationSignal[]; priorCountries: { country: string; observedAt: Date }[];
    proxyDetected?: boolean; torDetected?: boolean; newDevice?: boolean; sessionTakeoverRisk?: boolean;
    priorSimCountry?: string | null; currentSimCountry?: string | null;
  }): LocationAssessment {
    const riskSignals: LocationRiskSignal[] = [];
    const trusted = args.signals.filter((s) => [LocationSignalType.GPS, LocationSignalType.IP, LocationSignalType.SIM].includes(s.type) && s.country && s.confidence >= 0.6);
    const distinct = [...new Set(trusted.map((s) => s.country!.toUpperCase()))];
    let currentPhysicalCountry: string | null = null;
    if (distinct.length === 1) currentPhysicalCountry = distinct[0]!;
    else if (distinct.length > 1) {
      riskSignals.push(LocationRiskSignal.COUNTRY_MISMATCH);
      currentPhysicalCountry = trusted.find((s) => s.type === LocationSignalType.GPS && s.confidence >= 0.8)?.country?.toUpperCase() ?? null;
    }
    if (args.proxyDetected) riskSignals.push(LocationRiskSignal.VPN_OR_PROXY);
    if (args.torDetected) riskSignals.push(LocationRiskSignal.TOR_EXIT_NODE);
    if (args.newDevice) riskSignals.push(LocationRiskSignal.NEW_DEVICE);
    if (args.sessionTakeoverRisk) riskSignals.push(LocationRiskSignal.SESSION_TAKEOVER_RISK);
    if (args.priorSimCountry && args.currentSimCountry && args.priorSimCountry.toUpperCase() !== args.currentSimCountry.toUpperCase()) riskSignals.push(LocationRiskSignal.SIM_COUNTRY_CHANGE);
    const recent = [...args.priorCountries].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime()).slice(0, 5);
    if (new Set(recent.map((r) => r.country.toUpperCase())).size >= 4) riskSignals.push(LocationRiskSignal.RAPID_COUNTRY_HOPPING);
    const latest = recent[0];
    if (latest && currentPhysicalCountry && latest.country.toUpperCase() !== currentPhysicalCountry && Date.now() - latest.observedAt.getTime() < 1_800_000) riskSignals.push(LocationRiskSignal.IMPOSSIBLE_TRAVEL);
    const requiresStepUpAuth = riskSignals.some((s) => [LocationRiskSignal.TOR_EXIT_NODE, LocationRiskSignal.RAPID_COUNTRY_HOPPING, LocationRiskSignal.COUNTRY_MISMATCH, LocationRiskSignal.NEW_DEVICE, LocationRiskSignal.IMPOSSIBLE_TRAVEL, LocationRiskSignal.SESSION_TAKEOVER_RISK, LocationRiskSignal.SIM_COUNTRY_CHANGE].includes(s));
    const home = args.profile.regulatoryJurisdiction.toUpperCase();
    let locationRelationship = args.profile.locationRelationship;
    if (currentPhysicalCountry && currentPhysicalCountry !== home && locationRelationship === LocationRelationship.HOME) locationRelationship = LocationRelationship.TRAVELING;
    if (currentPhysicalCountry === home && [LocationRelationship.TRAVELING, LocationRelationship.LOCATION_MISMATCH].includes(locationRelationship)) locationRelationship = LocationRelationship.HOME;
    if (riskSignals.length >= 3) locationRelationship = LocationRelationship.LOCATION_HIGH_RISK;
    else if (riskSignals.includes(LocationRiskSignal.COUNTRY_MISMATCH)) locationRelationship = LocationRelationship.LOCATION_MISMATCH;
    return { currentPhysicalCountry, locationRelationship, riskSignals, requiresStepUpAuth, jurisdictionChanged: false };
  }
}

export class TravelTransactionPolicyEngine {
  decide(args: { relationship: LocationRelationship; riskSignals: LocationRiskSignal[]; transferAmountMinor: bigint; highValueThresholdMinor: bigint }): TravelTransactionPolicy {
    if (args.relationship === LocationRelationship.LOCATION_HIGH_RISK || args.riskSignals.some((s) => [LocationRiskSignal.TOR_EXIT_NODE, LocationRiskSignal.SESSION_TAKEOVER_RISK, LocationRiskSignal.IMPOSSIBLE_TRAVEL].includes(s))) return TravelTransactionPolicy.TEMPORARY_HOLD;
    if (args.riskSignals.includes(LocationRiskSignal.SPOOFED_LOCATION_SUSPECTED)) return TravelTransactionPolicy.RESTRICT_HIGH_RISK_ACTIONS;
    if (args.riskSignals.some((s) => [LocationRiskSignal.NEW_DEVICE, LocationRiskSignal.COUNTRY_MISMATCH, LocationRiskSignal.SIM_COUNTRY_CHANGE].includes(s)) || args.transferAmountMinor >= args.highValueThresholdMinor) return TravelTransactionPolicy.STEP_UP_REQUIRED;
    return TravelTransactionPolicy.NORMAL;
  }
}

export class JurisdictionV2Service {
  private readonly intelligence = new LocationIntelligenceEngine();
  private readonly travelPolicy = new TravelTransactionPolicyEngine();
  constructor(private readonly db: Database) {}

  async getProfile(userId: string): Promise<UserJurisdictionProfile> {
    const { rows } = await this.db.query(`SELECT * FROM user_jurisdiction_profiles_v2 WHERE user_id=$1`, [userId]);
    const r = rows[0];
    if (!r) throw new Error("JURISDICTION_PROFILE_NOT_FOUND");
    if (!r.regulatory_entity_id || !r.regulatory_jurisdiction) throw new Error("REGULATORY_JURISDICTION_NOT_CONFIGURED");
    return {
      userId: r.user_id, originalRegistrationCountry: r.original_registration_country, verifiedResidenceCountry: r.verified_residence_country,
      accountCountry: r.account_country, currentPhysicalCountry: r.current_physical_country, regulatoryEntityId: r.regulatory_entity_id,
      regulatoryJurisdiction: r.regulatory_jurisdiction, locationRelationship: r.location_relationship as LocationRelationship,
      migrationStatus: r.migration_status as JurisdictionMigrationStatus, jurisdictionVersion: r.jurisdiction_version
    };
  }

  async assessLocation(args: { userId: string; signals: LocationSignal[]; proxyDetected?: boolean; torDetected?: boolean; newDevice?: boolean; sessionTakeoverRisk?: boolean; priorSimCountry?: string | null; currentSimCountry?: string | null }): Promise<LocationAssessment> {
    const profile = await this.getProfile(args.userId);
    const history = await this.db.query(`SELECT country,observed_at FROM user_location_observations_v2 WHERE user_id=$1 AND country IS NOT NULL ORDER BY observed_at DESC LIMIT 5`, [args.userId]);
    const assessment = this.intelligence.assess({ ...args, profile, priorCountries: history.rows.map((r) => ({ country: r.country, observedAt: new Date(r.observed_at) })) });
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      for (const signal of args.signals) await client.query(`INSERT INTO user_location_observations_v2(user_id,signal_type,country,confidence,observed_at,metadata) VALUES($1,$2,$3,$4,$5,$6)`, [args.userId, signal.type, signal.country?.toUpperCase() ?? null, signal.confidence, signal.observedAt, JSON.stringify(signal.metadata ?? {})]);
      await client.query(`UPDATE user_jurisdiction_profiles_v2 SET current_physical_country=$2,location_relationship=$3,updated_at=now() WHERE user_id=$1`, [args.userId, assessment.currentPhysicalCountry, assessment.locationRelationship]);
      await client.query(`INSERT INTO jurisdiction_audit_events_v2(user_id,event_type,metadata) VALUES($1,'LOCATION_ASSESSED',$2)`, [args.userId, JSON.stringify(assessment)]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return assessment;
  }

  async authorizeSensitiveAction(args: { userId: string; action: SensitiveAction; deviceId?: string; sessionId?: string; walletId?: string; amountMinor?: bigint; currency?: string; location: LocationAssessment }): Promise<{ allowed: boolean; outcome: AuthorizationOutcome; walletJurisdiction?: string; regulatoryEntityId: string; reasonCodes: string[] }> {
    if (!args.sessionId) throw new Error("FRESH_AUTHENTICATED_SESSION_REQUIRED");
    if (!args.deviceId) throw new Error("DEVICE_BINDING_REQUIRED");
    const profile = await this.getProfile(args.userId);
    let walletJurisdiction: string | undefined;
    let entityId = profile.regulatoryEntityId;
    if (args.walletId) {
      const wallet = await this.db.query(`SELECT jurisdiction,regulatory_entity_id,status FROM linqasend_wallet_accounts_v2 WHERE id=$1 AND user_id=$2`, [args.walletId, args.userId]);
      const row = wallet.rows[0];
      if (!row) throw new Error("SOURCE_WALLET_NOT_FOUND");
      if (["FROZEN", "CLOSED"].includes(row.status)) throw new Error("SOURCE_WALLET_NOT_ACTIVE");
      walletJurisdiction = row.jurisdiction;
      entityId = row.regulatory_entity_id;
    }
    const policy = this.travelPolicy.decide({ relationship: args.location.locationRelationship, riskSignals: args.location.riskSignals, transferAmountMinor: args.amountMinor ?? 0n, highValueThresholdMinor: 500_000n });
    const outcome = policy === TravelTransactionPolicy.TEMPORARY_HOLD ? AuthorizationOutcome.TEMPORARY_HOLD : AuthorizationOutcome.STEP_UP;
    const allowed = policy !== TravelTransactionPolicy.TEMPORARY_HOLD;
    const reasonCodes = policy === TravelTransactionPolicy.NORMAL ? [`ACTION_${args.action}_STRONG_STEP_UP_REQUIRED`] : [...args.location.riskSignals];
    const id = randomUUID();
    await this.db.query(`INSERT INTO linqasend_action_authorizations_v2(id,user_id,action,wallet_id,device_id,session_id,outcome,allowed,location_assessment,reason_codes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, args.userId, args.action, args.walletId ?? null, args.deviceId, args.sessionId, outcome, allowed, JSON.stringify(args.location), reasonCodes]);
    return { allowed, outcome, ...(walletJurisdiction ? { walletJurisdiction } : {}), regulatoryEntityId: entityId, reasonCodes };
  }

  async requestRelocation(userId: string, targetCountry: string, reason?: string): Promise<{ id: string; status: JurisdictionMigrationStatus }> {
    const profile = await this.getProfile(userId);
    const target = targetCountry.toUpperCase();
    if (target === profile.regulatoryJurisdiction.toUpperCase()) throw new Error("TARGET_COUNTRY_ALREADY_CURRENT_JURISDICTION");
    const id = randomUUID();
    await this.db.query(`INSERT INTO jurisdiction_relocation_requests_v2(id,user_id,from_country,requested_country,status,reason) VALUES($1,$2,$3,$4,$5,$6)`, [id, userId, profile.regulatoryJurisdiction, target, JurisdictionMigrationStatus.DOCUMENTS_REQUIRED, reason ?? null]);
    await this.db.query(`UPDATE user_jurisdiction_profiles_v2 SET location_relationship='RELOCATION_PENDING',migration_status='DOCUMENTS_REQUIRED',updated_at=now() WHERE user_id=$1`, [userId]);
    await this.db.query(`INSERT INTO jurisdiction_audit_events_v2(user_id,event_type,metadata) VALUES($1,'JURISDICTION_RELOCATION_REQUESTED',$2)`, [userId, JSON.stringify({ requestId: id, fromCountry: profile.regulatoryJurisdiction, targetCountry: target })]);
    return { id, status: JurisdictionMigrationStatus.DOCUMENTS_REQUIRED };
  }

  async addRelocationEvidence(args: { userId: string; requestId: string; evidenceType: string; evidenceClass: string; country: string; objectKey: string; contentSha256: string }): Promise<{ id: string; status: string }> {
    if (!/^[a-f0-9]{64}$/i.test(args.contentSha256)) throw new Error("EVIDENCE_SHA256_REQUIRED");
    const request = await this.db.query(`SELECT requested_country,status FROM jurisdiction_relocation_requests_v2 WHERE id=$1 AND user_id=$2`, [args.requestId, args.userId]);
    if (!request.rows[0]) throw new Error("RELOCATION_REQUEST_NOT_FOUND");
    if (!["DOCUMENTS_REQUIRED", "UNDER_REVIEW"].includes(request.rows[0].status)) throw new Error("RELOCATION_REQUEST_NOT_ACCEPTING_EVIDENCE");
    if (request.rows[0].requested_country !== args.country.toUpperCase()) throw new Error("EVIDENCE_COUNTRY_MISMATCH");
    const id = randomUUID();
    await this.db.query(`INSERT INTO residency_evidence_v2(id,relocation_request_id,evidence_type,evidence_class,country,verification_status,object_key,content_sha256) VALUES($1,$2,$3,$4,$5,'PENDING',$6,$7)`, [id, args.requestId, args.evidenceType, args.evidenceClass, args.country.toUpperCase(), args.objectKey, args.contentSha256.toLowerCase()]);
    await this.db.query(`INSERT INTO jurisdiction_audit_events_v2(user_id,event_type,metadata) VALUES($1,'RELOCATION_EVIDENCE_ADDED',$2)`, [args.userId, JSON.stringify({ requestId: args.requestId, evidenceId: id, evidenceType: args.evidenceType, contentSha256: args.contentSha256.toLowerCase() })]);
    return { id, status: "PENDING" };
  }

  async reviewEvidence(args: { evidenceId: string; reviewerId: string; decision: "VERIFIED" | "REJECTED"; reasonCode: string }): Promise<void> {
    const result = await this.db.query(`UPDATE residency_evidence_v2 SET verification_status=$2,verified_at=now(),verified_by=$3,metadata=metadata||jsonb_build_object('reviewReasonCode',$4) WHERE id=$1 AND verification_status IN ('PENDING','MANUAL_REVIEW') RETURNING relocation_request_id`, [args.evidenceId, args.decision, args.reviewerId, args.reasonCode]);
    if (!result.rows[0]) throw new Error("EVIDENCE_NOT_REVIEWABLE");
    await this.db.query(`UPDATE jurisdiction_relocation_requests_v2 SET status='UNDER_REVIEW',updated_at=now() WHERE id=$1`, [result.rows[0].relocation_request_id]);
  }

  async approveRelocation(args: { requestId: string; approverId: string; targetRegulatoryEntityId: string; targetCurrency: string }): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const request = await client.query(`SELECT * FROM jurisdiction_relocation_requests_v2 WHERE id=$1 FOR UPDATE`, [args.requestId]);
      const row = request.rows[0];
      if (!row || !["UNDER_REVIEW", "DOCUMENTS_REQUIRED"].includes(row.status)) throw new Error("RELOCATION_REQUEST_NOT_APPROVABLE");
      const evidence = await client.query(`SELECT count(DISTINCT evidence_type)::int AS types,count(DISTINCT evidence_class)::int AS classes FROM residency_evidence_v2 WHERE relocation_request_id=$1 AND verification_status='VERIFIED' AND country=$2 AND (expires_at IS NULL OR expires_at>now())`, [args.requestId, row.requested_country]);
      if (Number(evidence.rows[0]?.types ?? 0) < 2 || Number(evidence.rows[0]?.classes ?? 0) < 2) throw new Error("INSUFFICIENT_DIVERSE_VERIFIED_RESIDENCY_EVIDENCE");
      const entity = await client.query(`SELECT id FROM linqasend_financial_entities_v7 WHERE id=$1 AND country_code=$2 AND status='ACTIVE' AND due_diligence_status='APPROVED'`, [args.targetRegulatoryEntityId, row.requested_country]);
      if (!entity.rows[0]) throw new Error("TARGET_REGULATORY_ENTITY_NOT_ELIGIBLE");
      const profile = await client.query(`UPDATE user_jurisdiction_profiles_v2 SET verified_residence_country=$2,account_country=$2,regulatory_jurisdiction=$2,regulatory_entity_id=$3,location_relationship='RELOCATED_VERIFIED',migration_status='APPROVED',jurisdiction_effective_from=now(),jurisdiction_version=jurisdiction_version+1,updated_at=now() WHERE user_id=$1 RETURNING jurisdiction_version`, [row.user_id, row.requested_country, args.targetRegulatoryEntityId]);
      if (!profile.rows[0]) throw new Error("JURISDICTION_PROFILE_NOT_FOUND");
      await client.query(`UPDATE jurisdiction_relocation_requests_v2 SET status='APPROVED',target_regulatory_entity_id=$2,decision_version=decision_version+1,decided_at=now(),decided_by=$3,updated_at=now() WHERE id=$1`, [args.requestId, args.targetRegulatoryEntityId, args.approverId]);
      await client.query(`INSERT INTO linqasend_wallet_accounts_v2(user_id,jurisdiction,regulatory_entity_id,currency,jurisdiction_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,jurisdiction,currency,jurisdiction_version) DO NOTHING`, [row.user_id, row.requested_country, args.targetRegulatoryEntityId, args.targetCurrency.toUpperCase(), profile.rows[0].jurisdiction_version]);
      await client.query(`INSERT INTO jurisdiction_audit_events_v2(user_id,event_type,metadata) VALUES($1,'JURISDICTION_MIGRATION_APPROVED',$2)`, [row.user_id, JSON.stringify({ requestId: args.requestId, fromCountry: row.from_country, toCountry: row.requested_country, regulatoryEntityId: args.targetRegulatoryEntityId, approverId: args.approverId })]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
