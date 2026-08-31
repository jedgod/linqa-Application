import { describe, expect, it } from "vitest";

/**
 * The release-gate scripts are plain ESM at the repo root so they can run with
 * bare `node`, before any build. Their decision logic lives in
 * `scripts/lib/home-release-policy.mjs` and is imported here through a
 * computed specifier: a literal path would be outside this package's rootDir
 * and `tsc` would refuse it, while the runtime resolution vitest performs is
 * exactly what the scripts themselves do.
 */
const policyUrl = new URL("../../../../scripts/lib/home-release-policy.mjs", import.meta.url).href;

type Rejection = { file: string; reason: string };

type Policy = {
  FABRICATED_CONTENT_MARKERS: string[];
  shouldScanFile(path: string): boolean;
  findFabricatedContent(files: Array<{ path: string; text: string }>): Array<{ path: string; marker: string }>;
  evaluateDeviceEvidence(input: {
    gitSha: string;
    manifests: Array<{ file: string; manifest: unknown }>;
    nowMs?: number;
    maxAgeHours?: number;
    required?: boolean;
  }): { ok: boolean; skipped: boolean; reason: string | null; accepted: unknown; rejected: Rejection[] };
  evaluateReleaseEvidence(input: { gitSha: string; evidence: unknown }): { ok: boolean; reason: string | null };
  evaluateProviderRedundancy(env: Record<string, string | undefined>): { ok: boolean; reason: string | null };
};

const policy: Policy = await import(policyUrl);

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const NOW = Date.parse("2026-08-30T12:00:00Z");

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    certification: "LINQA_HOME_PHYSICAL_DEVICE",
    gitSha: SHA,
    certifiedAt: new Date(NOW - 60 * 60_000).toISOString(),
    device: { serial: "R5CT10", model: "SM-A037U", os: "14" },
    packageName: "com.linqa.mobile",
    screenshot: "evidence/home/screenshot.png",
    screenshotSha256: "c".repeat(64),
    fatalRuntimeErrors: [],
    passed: true,
    ...overrides
  };
}

function evaluate(overrides: Record<string, unknown> = {}, options: { maxAgeHours?: number } = {}) {
  return policy.evaluateDeviceEvidence({
    gitSha: SHA,
    manifests: [{ file: `${SHA}-R5CT10-manifest.json`, manifest: manifest(overrides) }],
    nowMs: NOW,
    maxAgeHours: options.maxAgeHours ?? 72
  });
}

describe("home release gate: physical-device evidence binds to the exact Git SHA", () => {
  it("accepts a passing, fresh manifest for the exact SHA", () => {
    const result = evaluate();
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("blocks a release with no device evidence at all", () => {
    const result = policy.evaluateDeviceEvidence({ gitSha: SHA, manifests: [], nowMs: NOW });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("HOME_EXACT_SHA_DEVICE_EVIDENCE_MISSING");
  });

  it("rejects evidence certified against a different SHA", () => {
    // This is the whole purpose of exact-SHA binding: evidence from yesterday's
    // build is not evidence about this build.
    const result = evaluate({ gitSha: OTHER_SHA });
    expect(result.ok).toBe(false);
    expect(result.rejected[0]?.reason).toBe("SHA_MISMATCH");
  });

  it("rejects a manifest that did not pass", () => {
    expect(evaluate({ passed: false }).rejected[0]?.reason).toBe("CERTIFICATION_NOT_PASSED");
  });

  it("rejects a manifest reporting fatal runtime errors", () => {
    const result = evaluate({ fatalRuntimeErrors: ["/FATAL EXCEPTION/i"], passed: true });
    expect(result.ok).toBe(false);
    expect(result.rejected[0]?.reason).toBe("FATAL_RUNTIME_ERRORS_PRESENT");
  });

  it("rejects a manifest with no fatal-error scan section", () => {
    const withoutScan = manifest();
    delete (withoutScan as Record<string, unknown>).fatalRuntimeErrors;
    const result = policy.evaluateDeviceEvidence({
      gitSha: SHA,
      manifests: [{ file: "m.json", manifest: withoutScan }],
      nowMs: NOW
    });
    expect(result.rejected[0]?.reason).toBe("FATAL_SCAN_MISSING");
  });

  it("rejects evidence older than the freshness policy", () => {
    const result = evaluate({ certifiedAt: new Date(NOW - 80 * 3_600_000).toISOString() });
    expect(result.ok).toBe(false);
    expect(result.rejected[0]?.reason).toBe("EVIDENCE_TOO_OLD");
  });

  it("accepts evidence just inside the freshness window", () => {
    const result = evaluate({ certifiedAt: new Date(NOW - 71 * 3_600_000).toISOString() });
    expect(result.ok).toBe(true);
  });

  it("honours a tightened freshness window", () => {
    const result = evaluate(
      { certifiedAt: new Date(NOW - 10 * 3_600_000).toISOString() },
      { maxAgeHours: 4 }
    );
    expect(result.ok).toBe(false);
  });

  it("rejects future-dated evidence", () => {
    const result = evaluate({ certifiedAt: new Date(NOW + 24 * 3_600_000).toISOString() });
    expect(result.rejected[0]?.reason).toBe("CERTIFIED_AT_IN_FUTURE");
  });

  it("rejects an unparseable certification timestamp", () => {
    expect(evaluate({ certifiedAt: "sometime yesterday" }).rejected[0]?.reason)
      .toBe("CERTIFIED_AT_UNPARSEABLE");
  });

  it("requires the device model, so evidence names the hardware", () => {
    expect(evaluate({ device: { serial: "R5CT10", os: "14" } }).rejected[0]?.reason)
      .toBe("DEVICE_MODEL_MISSING");
  });

  it("requires a screenshot digest", () => {
    expect(evaluate({ screenshotSha256: "not-a-digest" }).rejected[0]?.reason)
      .toBe("SCREENSHOT_DIGEST_MISSING");
  });

  it("accepts a good manifest even when a bad one sits alongside it", () => {
    const result = policy.evaluateDeviceEvidence({
      gitSha: SHA,
      manifests: [
        { file: "stale.json", manifest: manifest({ gitSha: OTHER_SHA }) },
        { file: "good.json", manifest: manifest() }
      ],
      nowMs: NOW
    });
    expect(result.ok).toBe(true);
    expect(result.rejected).toHaveLength(1);
  });

  it("rejects a malformed SHA outright", () => {
    const result = policy.evaluateDeviceEvidence({ gitSha: "not-a-sha", manifests: [], nowMs: NOW });
    expect(result.reason).toBe("HOME_RELEASE_SHA_INVALID");
  });

  it("can be explicitly waived, and says so", () => {
    const result = policy.evaluateDeviceEvidence({
      gitSha: SHA,
      manifests: [],
      nowMs: NOW,
      required: false
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("DEVICE_EVIDENCE_NOT_REQUIRED");
  });
});

describe("home release gate: artifact digest evidence", () => {
  it("accepts evidence for the exact SHA with real digests", () => {
    const result = policy.evaluateReleaseEvidence({
      gitSha: SHA,
      evidence: { gitSha: SHA, artifacts: { androidApk: { path: "/tmp/app.apk", sha256: "d".repeat(64) } } }
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing evidence", () => {
    expect(policy.evaluateReleaseEvidence({ gitSha: SHA, evidence: null }).reason)
      .toBe("RELEASE_EVIDENCE_MISSING");
  });

  it("rejects a SHA mismatch", () => {
    const result = policy.evaluateReleaseEvidence({
      gitSha: SHA,
      evidence: { gitSha: OTHER_SHA, artifacts: { androidApk: { sha256: "d".repeat(64) } } }
    });
    expect(result.reason).toBe("RELEASE_EVIDENCE_SHA_MISMATCH");
  });

  it("rejects evidence with no artifacts, which cannot bind to a deployment", () => {
    expect(policy.evaluateReleaseEvidence({ gitSha: SHA, evidence: { gitSha: SHA, artifacts: {} } }).reason)
      .toBe("RELEASE_EVIDENCE_NO_ARTIFACTS");
  });

  it("rejects an artifact whose digest is not a SHA-256", () => {
    const result = policy.evaluateReleaseEvidence({
      gitSha: SHA,
      evidence: { gitSha: SHA, artifacts: { serverArtifact: { sha256: "deadbeef" } } }
    });
    expect(result.reason).toContain("RELEASE_EVIDENCE_ARTIFACT_DIGEST_INVALID:serverArtifact");
  });
});

describe("home release gate: provider redundancy", () => {
  it("passes with the primary enabled and an HTTPS secondary", () => {
    const result = policy.evaluateProviderRedundancy({
      HOME_NEWS_GDELT_ENABLED: "true",
      HOME_APPROVED_RSS_ENDPOINT: "https://feeds.example/news"
    });
    expect(result.ok).toBe(true);
  });

  it("blocks when the primary is disabled", () => {
    const result = policy.evaluateProviderRedundancy({
      HOME_NEWS_GDELT_ENABLED: "false",
      HOME_APPROVED_RSS_ENDPOINT: "https://feeds.example/news"
    });
    expect(result.reason).toBe("HOME_RELEASE_BLOCKED_PRIMARY_NEWS_PROVIDER_DISABLED");
  });

  it("blocks when there is no secondary provider", () => {
    const result = policy.evaluateProviderRedundancy({ HOME_NEWS_GDELT_ENABLED: "true" });
    expect(result.reason).toContain("HOME_RELEASE_BLOCKED_NO_SECONDARY_NEWS_PROVIDER");
  });

  it("does not count a plaintext secondary endpoint", () => {
    const result = policy.evaluateProviderRedundancy({
      HOME_NEWS_GDELT_ENABLED: "true",
      HOME_APPROVED_RSS_ENDPOINT: "http://feeds.example/news"
    });
    expect(result.reason).toContain("NOT_HTTPS");
  });

  it("does not count a malformed secondary endpoint", () => {
    const result = policy.evaluateProviderRedundancy({
      HOME_NEWS_GDELT_ENABLED: "true",
      HOME_APPROVED_RSS_ENDPOINT: "feeds.example"
    });
    expect(result.reason).toContain("MALFORMED");
  });
});

describe("home release gate: fabricated-content scan", () => {
  it("flags a hard-coded fabricated headline in shipped code", () => {
    const marker = policy.FABRICATED_CONTENT_MARKERS[0]!;
    const findings = policy.findFabricatedContent([
      { path: "server/src/home/news-router.service.ts", text: `const fallback = "${marker}";` }
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.marker).toBe(marker);
  });

  it("passes clean source", () => {
    const findings = policy.findFabricatedContent([
      { path: "server/src/home/news-router.service.ts", text: "return { articles: [], state: \"UNAVAILABLE\" };" }
    ]);
    expect(findings).toEqual([]);
  });

  it("skips non-code files", () => {
    expect(policy.shouldScanFile("docs/design.md")).toBe(false);
    expect(policy.shouldScanFile("evidence/home/manifest.png")).toBe(false);
    expect(policy.shouldScanFile("server/src/home/news-router.service.ts")).toBe(true);
  });

  it("skips the closure-pack specification text, which is not shipped code", () => {
    expect(policy.shouldScanFile("Linqa_Home_Production_Closure_Pack_v1.0.txt")).toBe(false);
  });

  it("does not flag the scanner's own marker list", () => {
    // Otherwise the gate fails on itself and can never pass.
    expect(policy.shouldScanFile("scripts/lib/home-release-policy.mjs")).toBe(false);
    expect(policy.shouldScanFile("scripts/verify-home-release-gate.mjs")).toBe(false);
  });

  it("normalizes Windows path separators before checking exclusions", () => {
    expect(policy.shouldScanFile("scripts\\lib\\home-release-policy.mjs")).toBe(false);
  });
});
