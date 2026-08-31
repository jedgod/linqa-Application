/**
 * Home release-gate policy, as pure functions.
 *
 * The gate scripts (`certify-home-device.mjs`, `verify-home-*.mjs`) do the
 * filesystem, git and adb plumbing; every actual pass/fail decision lives
 * here so it can be unit-tested without a device, a repo state or a network.
 * A release gate whose logic is only exercised by running the gate is a gate
 * nobody can trust.
 *
 * Plain ESM rather than TypeScript because the .mjs gate scripts must run
 * with bare `node`, before and independently of any build step.
 */

/** Substrings that would indicate hard-coded, fabricated news content. */
export const FABRICATED_CONTENT_MARKERS = [
  // Assembled from fragments so this policy file — and any test that imports
  // it — cannot itself trip the scanner that consumes the list.
  ["Global", "Tech", "Summit", "2026"].join(" "),
  ["fabricated", "Headline"].join(""),
  ["fake", "News", "Fallback"].join(""),
  ["mock", "Breaking", "News"].join(""),
  ["placeholder", "Story"].join(""),
  ["sample", "Headline"].join("")
];

/** Files the fabricated-content scan must skip: they legitimately name the markers. */
export const FABRICATED_SCAN_EXCLUDED = [
  "scripts/lib/home-release-policy.mjs",
  "scripts/verify-home-release-gate.mjs"
];

const SCANNABLE_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs|json)$/;

export function shouldScanFile(path) {
  if (!SCANNABLE_EXTENSION.test(path)) return false;
  const normalized = path.replace(/\\/g, "/");
  if (FABRICATED_SCAN_EXCLUDED.includes(normalized)) return false;
  // The closure packs themselves are specification text, not shipped code.
  if (/^Linqa_.*\.txt$/.test(normalized)) return false;
  return true;
}

/**
 * @param {Array<{ path: string, text: string }>} files
 * @returns {Array<{ path: string, marker: string }>}
 */
export function findFabricatedContent(files) {
  const findings = [];
  for (const file of files) {
    if (!shouldScanFile(file.path)) continue;
    for (const marker of FABRICATED_CONTENT_MARKERS) {
      if (file.text.includes(marker)) findings.push({ path: file.path, marker });
    }
  }
  return findings;
}

/**
 * Physical-device evidence policy: the manifest must belong to the exact Git
 * SHA under release, must have passed, must report no fatal runtime errors,
 * and must be fresh.
 *
 * @param {{
 *   gitSha: string,
 *   manifests: Array<{ file: string, manifest: any }>,
 *   nowMs?: number,
 *   maxAgeHours?: number,
 *   required?: boolean
 * }} input
 */
export function evaluateDeviceEvidence(input) {
  const { gitSha, manifests } = input;
  const nowMs = input.nowMs ?? Date.now();
  const maxAgeHours = input.maxAgeHours ?? 72;
  const required = input.required !== false;

  if (!required) {
    return { ok: true, skipped: true, reason: "DEVICE_EVIDENCE_NOT_REQUIRED", accepted: null, rejected: [] };
  }
  if (!gitSha || !/^[0-9a-f]{40}$/i.test(gitSha)) {
    return { ok: false, skipped: false, reason: "HOME_RELEASE_SHA_INVALID", accepted: null, rejected: [] };
  }
  if (!Array.isArray(manifests) || manifests.length === 0) {
    return {
      ok: false,
      skipped: false,
      reason: `HOME_EXACT_SHA_DEVICE_EVIDENCE_MISSING:${gitSha}`,
      accepted: null,
      rejected: []
    };
  }

  const rejected = [];
  for (const entry of manifests) {
    const manifest = entry?.manifest;
    const reject = (reason) => rejected.push({ file: entry?.file ?? "(unnamed)", reason });

    if (!manifest || typeof manifest !== "object") {
      reject("MANIFEST_NOT_AN_OBJECT");
      continue;
    }
    // A manifest whose SHA does not match is evidence about a *different*
    // build. This is the whole point of exact-SHA binding.
    if (manifest.gitSha !== gitSha) {
      reject("SHA_MISMATCH");
      continue;
    }
    if (manifest.passed !== true) {
      reject("CERTIFICATION_NOT_PASSED");
      continue;
    }
    if (!Array.isArray(manifest.fatalRuntimeErrors)) {
      reject("FATAL_SCAN_MISSING");
      continue;
    }
    if (manifest.fatalRuntimeErrors.length > 0) {
      reject("FATAL_RUNTIME_ERRORS_PRESENT");
      continue;
    }
    const certifiedAt = Date.parse(manifest.certifiedAt);
    if (!Number.isFinite(certifiedAt)) {
      reject("CERTIFIED_AT_UNPARSEABLE");
      continue;
    }
    // Future-dated evidence means a wrong clock or a doctored manifest;
    // either way it is not evidence.
    if (certifiedAt > nowMs + 5 * 60_000) {
      reject("CERTIFIED_AT_IN_FUTURE");
      continue;
    }
    const ageHours = (nowMs - certifiedAt) / 3_600_000;
    if (ageHours > maxAgeHours) {
      reject("EVIDENCE_TOO_OLD");
      continue;
    }
    if (!manifest.device || typeof manifest.device.model !== "string" || !manifest.device.model.trim()) {
      reject("DEVICE_MODEL_MISSING");
      continue;
    }
    if (typeof manifest.screenshotSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(manifest.screenshotSha256)) {
      reject("SCREENSHOT_DIGEST_MISSING");
      continue;
    }
    return { ok: true, skipped: false, reason: null, accepted: entry, rejected };
  }

  return {
    ok: false,
    skipped: false,
    reason: `HOME_DEVICE_EVIDENCE_REJECTED:max=${maxAgeHours}h`,
    accepted: null,
    rejected
  };
}

/**
 * Artifact-digest evidence policy: the manifest must be for the exact SHA and
 * every recorded artifact must carry a real SHA-256.
 *
 * @param {{ gitSha: string, evidence: any }} input
 */
export function evaluateReleaseEvidence(input) {
  const { gitSha, evidence } = input;
  if (!evidence || typeof evidence !== "object") {
    return { ok: false, reason: "RELEASE_EVIDENCE_MISSING" };
  }
  if (evidence.gitSha !== gitSha) {
    return { ok: false, reason: "RELEASE_EVIDENCE_SHA_MISMATCH" };
  }
  const artifacts = evidence.artifacts;
  if (!artifacts || typeof artifacts !== "object" || Object.keys(artifacts).length === 0) {
    // A release with no artifact digests cannot be bound to what was
    // actually deployed.
    return { ok: false, reason: "RELEASE_EVIDENCE_NO_ARTIFACTS" };
  }
  for (const [name, artifact] of Object.entries(artifacts)) {
    if (!artifact || typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(artifact.sha256)) {
      return { ok: false, reason: `RELEASE_EVIDENCE_ARTIFACT_DIGEST_INVALID:${name}` };
    }
  }
  return { ok: true, reason: null, artifactCount: Object.keys(artifacts).length };
}

/**
 * Provider-redundancy policy: Home must never ship depending on a single
 * upstream news provider.
 *
 * @param {Record<string, string | undefined>} env
 */
export function evaluateProviderRedundancy(env) {
  const primaryEnabled = env.HOME_NEWS_GDELT_ENABLED !== "false";
  const secondaryEndpoint = env.HOME_APPROVED_RSS_ENDPOINT;
  let secondaryEnabled = false;
  let secondaryReason = "HOME_APPROVED_RSS_ENDPOINT_NOT_SET";

  if (secondaryEndpoint) {
    try {
      // An http endpoint would reintroduce the plaintext path the validator
      // exists to block, so it does not count as a configured provider.
      secondaryEnabled = new URL(secondaryEndpoint).protocol === "https:";
      if (!secondaryEnabled) secondaryReason = "HOME_APPROVED_RSS_ENDPOINT_NOT_HTTPS";
    } catch {
      secondaryReason = "HOME_APPROVED_RSS_ENDPOINT_MALFORMED";
    }
  }

  if (!primaryEnabled) {
    return { ok: false, reason: "HOME_RELEASE_BLOCKED_PRIMARY_NEWS_PROVIDER_DISABLED" };
  }
  if (!secondaryEnabled) {
    return { ok: false, reason: `HOME_RELEASE_BLOCKED_NO_SECONDARY_NEWS_PROVIDER:${secondaryReason}` };
  }
  return { ok: true, reason: null };
}
