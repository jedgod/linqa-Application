import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertPhysicalDeviceCertification } from "../release-closure/device-certification.js";
import { evaluateDependencySecurity } from "../release-closure/dependency-security.js";
import { evaluateEvidence } from "../release-closure/evidence-policy.js";
import { assertExpo57MigrationGreen } from "../release-closure/expo57-migration.js";
import { assertPromotionAllowed } from "../release-closure/promotion-policy.js";
import { assertReleaseIdentity } from "../release-closure/release-identity.js";
import { detectForbiddenReleasePatterns } from "../release-closure/skipped-mock-detector.js";
import type { DeviceCertification, EvidenceRecord, EvidenceRequirement } from "../release-closure/types.js";

const release = {
  releaseVersion: "v1.2.3",
  gitSha: "0123456789abcdef0123456789abcdef01234567",
  artifactSha256: "a".repeat(64)
};

function device(overrides: Partial<DeviceCertification> = {}): DeviceCertification {
  return {
    evidenceId: "device-android-1", ...release, platform: "android", physicalDevice: true,
    model: "SM-A037U", osVersion: "13", releaseBuild: true, signedBuild: true,
    secureKeyCustody: true, privateKeyExportPrevented: true, phoneFirstRegistration: true,
    enrollmentPassed: true, keyPackagePassed: true, transparencyPassed: true,
    encryptedMessagingPassed: true, offlineRestartPassed: true, pushBackgroundPassed: true,
    revocationPassed: true, reinstallRecoveryPassed: true, upgradeFromPreviousReleasePassed: true,
    ...overrides
  };
}

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "evidence-1", controlId: "physical-device-android", result: "PASS",
    executionKind: "PHYSICAL_DEVICE", ...release, environment: "production-equivalent",
    producer: "device-lab", producedAt: new Date().toISOString(),
    device: { platform: "android", physical: true, model: "SM-A037U", osVersion: "13" },
    test: { name: "release journey", skipped: false, todo: false, mockProviderUsed: false, productionEquivalentDependencies: true },
    references: [{ path: "results/android.json", sha256: "b".repeat(64) }], ...overrides
  };
}

const requirement: EvidenceRequirement = {
  controlId: "physical-device-android", maxAgeHours: 72,
  allowedKinds: ["PHYSICAL_DEVICE"], physicalDeviceRequired: true,
  productionEquivalentRequired: true
};

describe("final release closure controls", () => {
  it("binds the release identity to the actual immutable artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "linqa-final-"));
    const artifactPath = join(root, "release.bin");
    await writeFile(artifactPath, "frozen-release");
    const artifactSha256 = createHash("sha256").update("frozen-release").digest("hex");
    await expect(assertReleaseIdentity({ ...release, artifactPath, artifactSha256, generatedAt: new Date().toISOString() })).resolves.toBeUndefined();
    await writeFile(artifactPath, "tampered-release");
    await expect(assertReleaseIdentity({ ...release, artifactPath, artifactSha256, generatedAt: new Date().toISOString() })).rejects.toThrow("RELEASE_ARTIFACT_HASH_MISMATCH");
  });

  it("blocks reachable high dependencies unless an approved unexpired risk covers the advisory", () => {
    const advisory = { id: "CVE-1", packageName: "example", severity: "high" as const, productionReachable: true, acceptedRiskId: "risk-1" };
    expect(evaluateDependencySecurity([advisory], []).green).toBe(false);
    expect(evaluateDependencySecurity([advisory], [{ id: "risk-1", advisoryIds: ["CVE-1"], approvedBySecurity: true, expiresAt: new Date(Date.now() + 60_000).toISOString(), compensatingControls: ["WAF"], rationale: "Not exploitable on the exposed path" }]).green).toBe(true);
  });

  it("rejects simulator, failed, stale, skipped, mock, and mismatched evidence", () => {
    expect(() => assertPhysicalDeviceCertification(device({ physicalDevice: false }), release)).toThrow("PHYSICAL_DEVICE_REQUIRED");
    expect(() => assertPhysicalDeviceCertification(device({ encryptedMessagingPassed: false }), release)).toThrow("encryptedMessagingPassed");
    expect(evaluateEvidence(requirement, [evidence()], release).passed).toBe(true);
    expect(evaluateEvidence(requirement, [evidence({ gitSha: "f".repeat(40) })], release).passed).toBe(false);
    expect(evaluateEvidence(requirement, [evidence({ producedAt: "2000-01-01T00:00:00.000Z" })], release).passed).toBe(false);
    expect(evaluateEvidence(requirement, [evidence({ test: { name: "release journey", skipped: true, todo: false, mockProviderUsed: false, productionEquivalentDependencies: true } })], release).passed).toBe(false);
    expect(evaluateEvidence(requirement, [evidence({ test: { name: "release journey", skipped: false, todo: false, mockProviderUsed: Boolean("true"), productionEquivalentDependencies: true } })], release).passed).toBe(false);
  });

  it("requires a complete Expo 52-to-57 migration and sequential promotion", () => {
    const migration = { fromSdk: 52 as const, toSdk: 57 as const, expoDoctorPassed: true, dependencyAlignmentPassed: true, nativePrebuildRegenerated: true, androidReleaseBuildPassed: true, iosReleaseBuildPassed: true, upgradeInstallPassedAndroid: true, upgradeInstallPassedIos: true, secureStorageRegressionPassed: true, nativeCryptoRegressionPassed: true, backgroundReceiveRegressionPassed: true, pushRegressionPassed: true, deepLinkRegressionPassed: true, otaRuntimeVersionValidated: true };
    expect(() => assertExpo57MigrationGreen(migration)).not.toThrow();
    expect(() => assertExpo57MigrationGreen({ ...migration, iosReleaseBuildPassed: false })).toThrow("EXPO57_MIGRATION_RED");
    expect(() => assertPromotionAllowed("RC_FROZEN", "CANARY")).not.toThrow();
    expect(() => assertPromotionAllowed("RC_FROZEN", "GA")).toThrow("INVALID_RELEASE_STAGE_TRANSITION");
  });

  it("finds skipped, todo, and fake-provider release tests", () => {
    const source = ["test", ".skip('x', () => {});\ntest", ".todo('y');\nnew FakeSms", "Provider();"].join("");
    const findings = detectForbiddenReleasePatterns("release.test.ts", source);
    expect(findings).toHaveLength(3);
  });
});
