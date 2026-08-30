import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../../db/pool.js";
import { SettlementTreasuryV5Service } from "./settlement-v5.js";

export interface BankStatementRecord { externalId: string; accountId: string; bookedAt: Date; valueAt?: Date; amountMinor: bigint; currency: string; direction: "PAYABLE" | "RECEIVABLE"; description: string; providerReference?: string; raw: Record<string, unknown> }
export interface EvidenceItem { kind: string; uri: string; sha256: string; capturedAt: string; expiresAt?: string; metadata?: Record<string, unknown> }

export function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  return JSON.stringify(value);
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let value = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { result.push(value); value = ""; }
    else value += char;
  }
  if (quoted) throw new Error("CSV_UNTERMINATED_QUOTE");
  result.push(value);
  return result;
}

export class CsvBankStatementParser {
  parse(input: string, expectedAccountId: string): BankStatementRecord[] {
    if (Buffer.byteLength(input, "utf8") > 10 * 1024 * 1024) throw new Error("BANK_STATEMENT_TOO_LARGE");
    const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) throw new Error("BANK_STATEMENT_EMPTY");
    if (lines.length > 100_001) throw new Error("BANK_STATEMENT_ROW_LIMIT_EXCEEDED");
    const headers = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
    const required = ["external_id", "account_id", "booked_at", "amount_minor", "currency", "direction", "description"];
    for (const name of required) if (!headers.includes(name)) throw new Error(`BANK_STATEMENT_COLUMN_MISSING:${name}`);
    return lines.slice(1).map((line, index) => {
      const cells = splitCsvLine(line);
      if (cells.length !== headers.length) throw new Error(`BANK_STATEMENT_INVALID_ROW:${index + 2}`);
      const row = Object.fromEntries(headers.map((h, i) => [h, cells[i]!.trim()]));
      if (row.account_id !== expectedAccountId) throw new Error(`BANK_STATEMENT_ACCOUNT_MISMATCH:${index + 2}`);
      if (!/^\d+$/.test(row.amount_minor!)) throw new Error(`BANK_STATEMENT_INVALID_AMOUNT:${index + 2}`);
      if (!/^[A-Z]{3}$/.test(row.currency!)) throw new Error(`BANK_STATEMENT_INVALID_CURRENCY:${index + 2}`);
      if (!['PAYABLE', 'RECEIVABLE'].includes(row.direction!)) throw new Error(`BANK_STATEMENT_INVALID_DIRECTION:${index + 2}`);
      const bookedAt = new Date(row.booked_at!);
      if (Number.isNaN(bookedAt.getTime())) throw new Error(`BANK_STATEMENT_INVALID_DATE:${index + 2}`);
      return { externalId: row.external_id!, accountId: row.account_id!, bookedAt, ...(row.value_at ? { valueAt: new Date(row.value_at) } : {}), amountMinor: BigInt(row.amount_minor!), currency: row.currency!, direction: row.direction as "PAYABLE" | "RECEIVABLE", description: row.description!, ...(row.provider_reference ? { providerReference: row.provider_reference } : {}), raw: row };
    });
  }
}

export function detectNonProductionTests(sources: Array<{ path: string; content: string }>): { skipped: string[]; focused: string[]; mockOnly: boolean; reasons: string[] } {
  const skipped: string[] = [], focused: string[] = [], reasons: string[] = [];
  let physicalAssertions = 0, mockReferences = 0;
  for (const source of sources) {
    if (/\b(?:it|test|describe)\.skip\s*\(/.test(source.content) || /\bxit\s*\(/.test(source.content)) skipped.push(source.path);
    if (/\b(?:it|test|describe)\.only\s*\(/.test(source.content) || /\bfit\s*\(/.test(source.content)) focused.push(source.path);
    if (/physical|live[-_ ]transaction|provider[-_ ]sandbox/i.test(source.content)) physicalAssertions++;
    if (/\bmock(?:ed|Resolved|Implementation)?\b|\bvi\.fn\b|\bjest\.fn\b/i.test(source.content)) mockReferences++;
  }
  if (skipped.length) reasons.push("SKIPPED_TESTS_PRESENT");
  if (focused.length) reasons.push("FOCUSED_TESTS_PRESENT");
  const mockOnly = sources.length > 0 && mockReferences > 0 && physicalAssertions === 0;
  if (mockOnly) reasons.push("CERTIFICATION_IS_MOCK_ONLY");
  return { skipped, focused, mockOnly, reasons };
}

export class ProductionClosureV6Service {
  private readonly settlement: SettlementTreasuryV5Service;
  private readonly csv = new CsvBankStatementParser();
  constructor(private readonly db: Database) { this.settlement = new SettlementTreasuryV5Service(db); }

  async ingestBankStatement(args: { sourceAccountId: string; content: string; uploadedBy: string }): Promise<{ batchId: string; fileHash: string; imported: number; duplicates: number }> {
    const fileHash = sha256(args.content);
    const prior = await this.db.query(`SELECT id,imported_count,duplicate_count FROM linqasend_ingestion_batches_v6 WHERE source_type='BANK' AND file_hash=$1`, [fileHash]);
    if (prior.rows[0]) return { batchId: prior.rows[0].id, fileHash, imported: prior.rows[0].imported_count, duplicates: prior.rows[0].duplicate_count };
    const records = this.csv.parse(args.content, args.sourceAccountId);
    const batchId = randomUUID();
    await this.db.query(`INSERT INTO linqasend_ingestion_batches_v6(id,source_type,source_id,file_hash,status,uploaded_by) VALUES($1,'BANK',$2,$3,'PROCESSING',$4)`, [batchId, args.sourceAccountId, fileHash, args.uploadedBy]);
    try {
      const result = await this.settlement.importExternalRecords({ sourceType: "BANK", sourceId: args.sourceAccountId, fileHash, records: records.map((r) => ({ externalId: r.externalId, ...(r.providerReference ? { providerReference: r.providerReference } : {}), amountMinor: r.amountMinor, currency: r.currency, direction: r.direction, occurredAt: r.bookedAt, raw: r.raw })) });
      await this.db.query(`UPDATE linqasend_ingestion_batches_v6 SET status='COMPLETED',record_count=$2,imported_count=$3,duplicate_count=$4,completed_at=now() WHERE id=$1`, [batchId, records.length, result.imported, result.duplicates]);
      return { batchId, fileHash, ...result };
    } catch (error) {
      await this.db.query(`UPDATE linqasend_ingestion_batches_v6 SET status='FAILED',error_message=$2,completed_at=now() WHERE id=$1`, [batchId, error instanceof Error ? error.message : "unknown"]);
      throw error;
    }
  }

  async bindEvidence(args: { subjectType: string; subjectId: string; gitSha: string; artifactDigest: string; items: EvidenceItem[]; createdBy: string }): Promise<{ id: string; manifestHash: string }> {
    if (!/^[a-f0-9]{40}$/i.test(args.gitSha)) throw new Error("EXACT_GIT_SHA_REQUIRED");
    if (args.items.length === 0) throw new Error("EVIDENCE_ITEMS_REQUIRED");
    for (const item of args.items) {
      if (!/^[a-f0-9]{64}$/i.test(item.sha256)) throw new Error(`INVALID_EVIDENCE_SHA:${item.uri}`);
      if (item.expiresAt && new Date(item.expiresAt) <= new Date()) throw new Error(`EVIDENCE_EXPIRED:${item.uri}`);
    }
    const manifest = { subjectType: args.subjectType, subjectId: args.subjectId, gitSha: args.gitSha.toLowerCase(), artifactDigest: args.artifactDigest, items: args.items };
    const manifestHash = sha256(stableJson(manifest));
    const id = randomUUID();
    await this.db.query(`INSERT INTO linqasend_evidence_manifests_v6(id,subject_type,subject_id,git_sha,artifact_digest,items,manifest_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, args.subjectType, args.subjectId, args.gitSha.toLowerCase(), args.artifactDigest, JSON.stringify(args.items), manifestHash, args.createdBy]);
    return { id, manifestHash };
  }

  async certifyProvider(args: { providerId: string; gitSha: string; adapterVersion: string; evidenceManifestId: string; certifiedBy: string; expiresAt: Date }): Promise<{ id: string; status: string }> {
    const evidence = await this.db.query(`SELECT git_sha FROM linqasend_evidence_manifests_v6 WHERE id=$1`, [args.evidenceManifestId]);
    if (!evidence.rows[0] || evidence.rows[0].git_sha !== args.gitSha.toLowerCase()) throw new Error("PROVIDER_EVIDENCE_SHA_MISMATCH");
    const id = randomUUID();
    await this.db.query(`INSERT INTO linqasend_provider_certifications_v6(id,provider_id,adapter_version,git_sha,evidence_manifest_id,status,certified_by,certified_at,expires_at) VALUES($1,$2,$3,$4,$5,'CERTIFIED',$6,now(),$7)`, [id, args.providerId, args.adapterVersion, args.gitSha.toLowerCase(), args.evidenceManifestId, args.certifiedBy, args.expiresAt]);
    return { id, status: "CERTIFIED" };
  }

  async recordPhysicalCertification(args: { corridorRuleId: string; providerId: string; gitSha: string; environment: string; testCases: Array<{ case: string; passed: boolean; mock: boolean; providerReference?: string; evidenceSha256: string }>; evidenceManifestId: string }): Promise<{ id: string; passed: boolean }> {
    const required = ["INTERNAL_DOMESTIC", "INTERNAL_CROSS_BORDER", "EXTERNAL_DOMESTIC", "EXTERNAL_CROSS_BORDER", "BLOCKED_CORRIDOR", "NEW_RECIPIENT_SCAM_WARNING", "ACCOUNT_RECOVERY_COOLDOWN", "WEBHOOK_REPLAY", "REFUND", "REVERSAL", "CHARGEBACK", "PROVIDER_OUTAGE", "RECONCILIATION_BREAK", "SAFEGUARDING_SHORTFALL"];
    const passedCases = new Set(args.testCases.filter((test) => test.passed && !test.mock && /^[a-f0-9]{64}$/i.test(test.evidenceSha256)).map((test) => test.case));
    const missing = required.filter((name) => !passedCases.has(name));
    const passed = missing.length === 0;
    const evidence = await this.db.query(`SELECT git_sha FROM linqasend_evidence_manifests_v6 WHERE id=$1`, [args.evidenceManifestId]);
    if (!evidence.rows[0] || evidence.rows[0].git_sha !== args.gitSha.toLowerCase()) throw new Error("PHYSICAL_EVIDENCE_SHA_MISMATCH");
    const id = randomUUID();
    await this.db.query(`INSERT INTO linqasend_physical_certification_runs_v6(id,corridor_rule_id,provider_id,git_sha,environment,test_cases,passed,evidence_manifest_id,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())`, [id, args.corridorRuleId, args.providerId, args.gitSha.toLowerCase(), args.environment, JSON.stringify({ cases: args.testCases, missing }), passed, args.evidenceManifestId]);
    return { id, passed };
  }

  async certifyCorridor(args: { corridorRuleId: string; gitSha: string; evidenceManifestId: string; certifiedBy: string; expiresAt: Date; failureTestsPassed: boolean }): Promise<{ id: string; status: string }> {
    const physical = await this.db.query(`SELECT passed FROM linqasend_physical_certification_runs_v6 WHERE corridor_rule_id=$1 AND git_sha=$2 AND evidence_manifest_id=$3 ORDER BY completed_at DESC LIMIT 1`, [args.corridorRuleId, args.gitSha.toLowerCase(), args.evidenceManifestId]);
    if (!physical.rows[0]?.passed) throw new Error("PHYSICAL_CERTIFICATION_NOT_PASSED");
    if (!args.failureTestsPassed) throw new Error("FAILURE_INJECTION_CERTIFICATION_NOT_PASSED");
    const id = randomUUID();
    await this.db.query(`INSERT INTO linqasend_corridor_certifications_v6(id,corridor_rule_id,git_sha,evidence_manifest_id,status,physical_tests_passed,failure_tests_passed,certified_by,expires_at) VALUES($1,$2,$3,$4,'CERTIFIED',true,true,$5,$6)`, [id, args.corridorRuleId, args.gitSha.toLowerCase(), args.evidenceManifestId, args.certifiedBy, args.expiresAt]);
    return { id, status: "CERTIFIED" };
  }

  async createReleaseManifest(args: { releaseVersion: string; gitSha: string; artifactDigest: string; environment: string; corridorIds: string[]; providerIds: string[]; createdBy: string }): Promise<{ id: string; status: string }> {
    if (!/^[a-f0-9]{40}$/i.test(args.gitSha) || !/^[a-f0-9]{64}$/i.test(args.artifactDigest)) throw new Error("EXACT_RELEASE_IDENTITY_REQUIRED");
    const id = randomUUID();
    await this.db.query(`INSERT INTO linqasend_release_manifests_v6(id,release_version,git_sha,artifact_digest,environment,corridor_ids,provider_ids,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8)`, [id, args.releaseVersion, args.gitSha.toLowerCase(), args.artifactDigest.toLowerCase(), args.environment, args.corridorIds, args.providerIds, args.createdBy]);
    return { id, status: "DRAFT" };
  }

  async signOffRelease(args: { id: string; actorId: string; role: "OPERATIONS" | "COMPLIANCE" }): Promise<{ status: string }> {
    const column = args.role === "OPERATIONS" ? "operations_signoff_by" : "compliance_signoff_by";
    const other = args.role === "OPERATIONS" ? "compliance_signoff_by" : "operations_signoff_by";
    const result = await this.db.query(`UPDATE linqasend_release_manifests_v6 SET ${column}=$2 WHERE id=$1 AND status='DRAFT' AND (${other} IS NULL OR ${other}<>$2) RETURNING operations_signoff_by,compliance_signoff_by`, [args.id, args.actorId]);
    const row = result.rows[0];
    if (!row) throw new Error("RELEASE_SIGNOFF_NOT_ALLOWED_OR_SELF_APPROVAL");
    const status = row.operations_signoff_by && row.compliance_signoff_by ? "APPROVED" : "DRAFT";
    if (status === "APPROVED") await this.db.query(`UPDATE linqasend_release_manifests_v6 SET status='APPROVED',approved_at=now() WHERE id=$1`, [args.id]);
    return { status };
  }

  async evaluateGaGate(args: { gitSha: string; artifactDigest: string; corridorIds: string[]; environment: string; evaluatedBy: string }): Promise<{ id: string; allowed: boolean; blockers: string[] }> {
    const blockers: string[] = [];
    if (!/^[a-f0-9]{40}$/i.test(args.gitSha)) blockers.push("EXACT_GIT_SHA_REQUIRED");
    const eod = await this.db.query(`SELECT status FROM linqasend_eod_controls_v5 ORDER BY control_date DESC LIMIT 1`);
    if (!eod.rows[0]) blockers.push("EOD_CONTROL_MISSING"); else if (eod.rows[0].status === "RED") blockers.push("LATEST_EOD_RED");
    const critical = await this.db.query(`SELECT count(*)::int AS count FROM linqasend_reconciliation_breaks_v5 WHERE status='OPEN' AND severity='CRITICAL'`);
    if (Number(critical.rows[0]?.count ?? 0) > 0) blockers.push("OPEN_CRITICAL_RECONCILIATION_BREAKS");
    for (const corridorId of args.corridorIds) {
      const cert = await this.db.query(`SELECT * FROM linqasend_corridor_certifications_v6 WHERE corridor_rule_id=$1 AND status='CERTIFIED' AND git_sha=$2 AND expires_at>now() ORDER BY certified_at DESC LIMIT 1`, [corridorId, args.gitSha.toLowerCase()]);
      if (!cert.rows[0]) blockers.push(`CORRIDOR_NOT_CERTIFIED:${corridorId}`);
    }
    const release = await this.db.query(`SELECT id FROM linqasend_release_manifests_v6 WHERE git_sha=$1 AND artifact_digest=$2 AND environment=$3 AND status='APPROVED' ORDER BY created_at DESC LIMIT 1`, [args.gitSha.toLowerCase(), args.artifactDigest, args.environment]);
    if (!release.rows[0]) blockers.push("RELEASE_MANIFEST_NOT_APPROVED_OR_ARTIFACT_MISMATCH");
    const id = randomUUID(), allowed = blockers.length === 0;
    await this.db.query(`INSERT INTO linqasend_ga_gate_runs_v6(id,git_sha,artifact_digest,environment,allowed,blockers,evaluated_by) VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, args.gitSha.toLowerCase(), args.artifactDigest, args.environment, allowed, blockers, args.evaluatedBy]);
    return { id, allowed, blockers };
  }

  buildReconciliationFailure(kind: "MISSING_EXTERNAL" | "MISSING_INTERNAL" | "AMOUNT_MISMATCH" | "DUPLICATE_EXTERNAL" | "LATE_EXTERNAL" | "WRONG_CURRENCY" | "WRONG_PROVIDER_REFERENCE", record: Record<string, unknown>): Record<string, unknown> {
    const copy = structuredClone(record);
    if (kind === "AMOUNT_MISMATCH") copy.amountMinor = (BigInt(String(copy.amountMinor ?? 0)) + 1n).toString();
    if (kind === "DUPLICATE_EXTERNAL") copy.duplicate = true;
    if (kind === "LATE_EXTERNAL") copy.occurredAt = new Date(Date.now() + 86_400_000).toISOString();
    if (kind === "WRONG_CURRENCY") copy.currency = copy.currency === "USD" ? "EUR" : "USD";
    if (kind === "WRONG_PROVIDER_REFERENCE") copy.providerReference = `invalid-${randomUUID()}`;
    if (kind === "MISSING_EXTERNAL") copy.omitExternal = true;
    if (kind === "MISSING_INTERNAL") copy.omitInternal = true;
    return copy;
  }
}
