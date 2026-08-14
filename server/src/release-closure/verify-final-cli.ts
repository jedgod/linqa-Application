import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertFinalReleaseClosure } from "./final-release-controller.js";
import type { DeviceCertification, EvidenceRecord, EvidenceRequirement, Expo57MigrationEvidence, ReleaseIdentity } from "./types.js";
import type { AcceptedRisk, Advisory } from "./dependency-security.js";

interface FinalReleaseInput {
  identity: ReleaseIdentity;
  advisories: Advisory[];
  acceptedRisks: AcceptedRisk[];
  expo57: Expo57MigrationEvidence;
  devices: DeviceCertification[];
  requirements: EvidenceRequirement[];
  evidence: EvidenceRecord[];
}

const inputPath = resolve(process.env.LINQA_FINAL_RELEASE_INPUT ?? "release-evidence/current/final-release-input.json");
const input = JSON.parse(await readFile(inputPath, "utf8")) as FinalReleaseInput;
const artifactPath = process.env.LINQA_RELEASE_ARTIFACT;
const publicKey = process.env.LINQA_EVIDENCE_SIGNING_PUBLIC_KEY_PEM;
if (!artifactPath || !publicKey) throw new Error("LINQA_RELEASE_ARTIFACT and LINQA_EVIDENCE_SIGNING_PUBLIC_KEY_PEM are required");
const result = await assertFinalReleaseClosure({
  ...input,
  identity: { ...input.identity, artifactPath: resolve(artifactPath) },
  assurancePublicKey: publicKey,
  g0ToG4Root: resolve(process.env.LINQA_G0_G4_EVIDENCE_ROOT ?? "release-evidence"),
  g5Root: resolve(process.env.LINQA_G5_EVIDENCE_ROOT ?? "release-evidence/g5"),
  evidenceRoot: resolve(process.env.LINQA_FINAL_EVIDENCE_ROOT ?? "release-evidence/current")
});
console.log(`FINAL RELEASE CLOSURE ${result.status}: ${result.releaseVersion} @ ${result.gitSha} artifact ${result.artifactSha256}`);
