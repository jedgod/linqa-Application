import { describe, expect, it } from "vitest";
import { CapabilityStatus, FundingMode, RailType, ReceiveMode, RecipientType, RegulatoryCapabilityEngine, TransferClass, TransferClassifier, type CapabilityRepository, type SenderContext } from "../services/linqasend/classification-v3.js";
import { PaymentRiskEngineV4, TransactionSignatureService, deterministicTransferId, verifyDevicePaymentAssertion } from "../services/linqasend/security-v4.js";
import { generateKeyPairSync, sign } from "node:crypto";
import { LocationIntelligenceEngine, LocationRelationship, LocationRiskSignal, LocationSignalType, TravelTransactionPolicy, TravelTransactionPolicyEngine } from "../services/linqasend/jurisdiction-v2.js";
import { ResponsibilityRequirementService } from "../services/linqasend/regulatory-v7.js";
import { CsvBankStatementParser, detectNonProductionTests, sha256, stableJson } from "../services/linqasend/closure-v6.js";

const sender: SenderContext = { userId: "u1", verifiedCountry: "US", baseCurrency: "USD", kycLevel: 2, kycStatus: "VERIFIED", riskScore: 0, deviceTrust: "TRUSTED", accountStatus: "ACTIVE" };

describe("LinqaSend v3 capability engine", () => {
  it("classifies all four transfer shapes independently of funding mode", () => {
    const classifier = new TransferClassifier();
    const recipient = (internal: boolean, country: string) => ({ recipientType: internal ? RecipientType.LINQA_USER : RecipientType.BANK_RECIPIENT, recipientId: "r", verifiedCountry: country, receiveCurrency: country === "US" ? "USD" : "GHS", receiveMode: internal ? ReceiveMode.LINQA_BALANCE : ReceiveMode.BANK, verified: true });
    expect(classifier.classify(sender, recipient(true, "US")).transferClass).toBe(TransferClass.INTERNAL_DOMESTIC);
    expect(classifier.classify(sender, recipient(true, "GH")).transferClass).toBe(TransferClass.INTERNAL_CROSS_BORDER);
    expect(classifier.classify(sender, recipient(false, "US")).transferClass).toBe(TransferClass.EXTERNAL_DOMESTIC);
    expect(classifier.classify(sender, recipient(false, "GH")).transferClass).toBe(TransferClass.EXTERNAL_CROSS_BORDER);
  });

  it("fails closed when no effective country or corridor policy exists", async () => {
    const repo: CapabilityRepository = { getActiveCountryVersion: async () => null, getActiveCorridorVersion: async () => null };
    const engine = new RegulatoryCapabilityEngine(repo);
    const recipient = { recipientType: RecipientType.LINQA_USER, recipientId: "r", verifiedCountry: "US", receiveCurrency: "USD", receiveMode: ReceiveMode.LINQA_BALANCE, verified: true };
    const classification = new TransferClassifier().classify(sender, recipient);
    await expect(engine.decide({ sender, recipient, classification, amount: { amountMinor: 100n, currency: "USD" }, fundingMode: FundingMode.LINQA_BALANCE, receiveMode: ReceiveMode.LINQA_BALANCE })).resolves.toMatchObject({ allowed: false, reasonCode: "COUNTRY_CAPABILITY_NOT_CONFIGURED" });
  });

  it("permits only the configured bank rail for bank-outbound-only corridors", async () => {
    const repo: CapabilityRepository = { getActiveCountryVersion: async () => null, getActiveCorridorVersion: async () => ({ id: "c1", sourceCountry: "US", destinationCountry: "GH", transferClass: TransferClass.EXTERNAL_CROSS_BORDER, version: 1, status: CapabilityStatus.BANK_OUTBOUND_ONLY, effectiveFrom: new Date(0), sourceCurrencies: ["USD"], destinationCurrencies: ["GHS"], permittedFundingModes: [FundingMode.BANK], permittedReceiveModes: [ReceiveMode.BANK], permittedRails: [RailType.CARD_PUSH, RailType.CORRESPONDENT_BANK], minKycLevel: 1 }) };
    const engine = new RegulatoryCapabilityEngine(repo);
    const recipient = { recipientType: RecipientType.BANK_RECIPIENT, recipientId: "r", verifiedCountry: "GH", receiveCurrency: "GHS", receiveMode: ReceiveMode.BANK, verified: true };
    const decision = await engine.decide({ sender, recipient, classification: new TransferClassifier().classify(sender, recipient), amount: { amountMinor: 100n, currency: "USD" }, fundingMode: FundingMode.BANK, receiveMode: ReceiveMode.BANK });
    expect(decision).toMatchObject({ allowed: true, permittedRails: [RailType.CORRESPONDENT_BANK], requiresFx: true });
  });
});

describe("LinqaSend v4 security", () => {
  it("binds authorization hashes and deterministic intent ids to exact transaction fields", () => {
    const id = deterministicTransferId("user", "idempotency-key-123456");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(id).toBe(deterministicTransferId("user", "idempotency-key-123456"));
    const service = new TransactionSignatureService();
    const base = { id, senderUserId: "user", recipientId: "recipient", quoteId: "quote", sourceAmountMinor: 100n, sourceCurrency: "usd", destinationAmountMinor: 900n, destinationCurrency: "ghs", fundingSourceId: "fund", transferClass: "EXTERNAL_CROSS_BORDER" };
    expect(service.buildTransactionHash(base)).not.toBe(service.buildTransactionHash({ ...base, destinationAmountMinor: 901n }));
  });

  it("freezes revoked devices and high-risk relationships", () => {
    const result = new PaymentRiskEngineV4().assess({ accountAgeDays: 100, deviceTrust: "REVOKED", deviceAgeDays: 100, recentPasswordReset: false, recentRecoveryChange: false, recentPhoneChange: false, recentDeviceEnrollment: false, recipientIsNew: false, priorSuccessfulTransfers: 4, relationshipAgeDays: 30, transferCount1h: 0, transferCount24h: 0, amountSent24hMinor: 0n, amountDeviationRatio: 1, fundingSourceAgeDays: 30, fundingSourceReuseAcrossAccounts: 1, countryMismatch: false, impossibleTravelSignal: false, priorChargebacks: 0, priorFailedFundingAttempts: 0, quoteAgeSeconds: 1, blockedRelationship: true });
    expect(result).toMatchObject({ score: 100, decision: "FREEZE" });
  });

  it("verifies a transaction-bound Ed25519 device assertion and rejects changed amounts/hash", () => {
    const keys = generateKeyPairSync("ed25519");
    const jwk = keys.publicKey.export({ format: "jwk" });
    const publicKey = Buffer.from(jwk.x!, "base64url");
    const nonce = "challenge-nonce", transactionHash = "a".repeat(64);
    const signatureBase64 = sign(null, Buffer.from(`${nonce}|${transactionHash}`), keys.privateKey).toString("base64");
    expect(verifyDevicePaymentAssertion({ publicKey, nonce, transactionHash, signatureBase64 })).toBe(true);
    expect(verifyDevicePaymentAssertion({ publicKey, nonce, transactionHash: "b".repeat(64), signatureBase64 })).toBe(false);
  });
});

describe("jurisdiction and real-money responsibility controls", () => {
  it("detects conflicting location signals without changing jurisdiction", () => {
    const result = new LocationIntelligenceEngine().assess({ profile: { userId: "u", originalRegistrationCountry: "US", verifiedResidenceCountry: "US", accountCountry: "US", currentPhysicalCountry: null, regulatoryEntityId: "e", regulatoryJurisdiction: "US", locationRelationship: LocationRelationship.HOME, migrationStatus: "NONE" as never, jurisdictionVersion: 1 }, signals: [{ type: LocationSignalType.IP, country: "US", confidence: 0.9, observedAt: new Date() }, { type: LocationSignalType.GPS, country: "GH", confidence: 0.9, observedAt: new Date() }], priorCountries: [] });
    expect(result.riskSignals).toContain(LocationRiskSignal.COUNTRY_MISMATCH);
    expect(result.jurisdictionChanged).toBe(false);
  });

  it("holds impossible travel and derives cross-border/FX partner duties", () => {
    expect(new TravelTransactionPolicyEngine().decide({ relationship: LocationRelationship.TRAVELING, riskSignals: [LocationRiskSignal.IMPOSSIBLE_TRAVEL], transferAmountMinor: 1n, highValueThresholdMinor: 500_000n })).toBe(TravelTransactionPolicy.TEMPORARY_HOLD);
    const duties = new ResponsibilityRequirementService().derive({ transferClass: "EXTERNAL_CROSS_BORDER", fundingMode: "DEBIT_CARD", receiveMode: "BANK", sourceCurrency: "USD", destinationCurrency: "GHS", custodyModel: "PASS_THROUGH_ONLY" });
    expect(duties.CROSS_BORDER_TRANSMISSION).toBe("REQUIRED");
    expect(duties.FX_EXECUTION).toBe("REQUIRED");
    expect(duties.CARD_ACQUIRING).toBe("REQUIRED");
    expect(duties.LOCAL_BANK_PAYOUT).toBe("REQUIRED");
  });
});

describe("v6 production closure", () => {
  it("parses quoted bank CSV exactly and rejects account substitution", () => {
    const csv = 'external_id,account_id,booked_at,amount_minor,currency,direction,description\n"tx,1",safe-usd,2026-08-20T10:00:00Z,1250,USD,RECEIVABLE,"Settlement, batch 1"';
    const parser = new CsvBankStatementParser();
    expect(parser.parse(csv, "safe-usd")[0]).toMatchObject({ externalId: "tx,1", amountMinor: 1250n });
    expect(() => parser.parse(csv, "operating-usd")).toThrow("BANK_STATEMENT_ACCOUNT_MISMATCH");
  });

  it("detects skipped/focused/mock-only certification and hashes stable evidence", () => {
    const detection = detectNonProductionTests([{ path: "cert.test.ts", content: "describe.only('x',()=>it.skip('y',()=>vi.fn()))" }]);
    expect(detection.reasons).toEqual(expect.arrayContaining(["SKIPPED_TESTS_PRESENT", "FOCUSED_TESTS_PRESENT", "CERTIFICATION_IS_MOCK_ONLY"]));
    expect(sha256(stableJson({ b: 2, a: 1 }))).toBe(sha256(stableJson({ a: 1, b: 2 })));
  });
});
