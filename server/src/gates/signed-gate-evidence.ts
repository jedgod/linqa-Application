import { verify } from "node:crypto";
import type { GateCheck, GateName } from "./types.js";

export const REQUIRED_EXTERNAL_CHECKS: Record<GateName, string[]> = {
  G0: ["truthful-failure-injection", "production-boot-refusal"],
  G1: ["fresh-phone-registration", "device-enrollment", "signed-key-package", "transparency-inclusion", "recovery-email", "revoked-device"],
  G2: ["two-client-exchange", "offline-reconnect", "sender-restart", "receiver-restart", "server-restart", "replay-rejected", "tamper-rejected", "wrong-aad-rejected", "expired-package-rejected", "plaintext-rejected", "duplicate-ack-safe"],
  G3: ["uniffi-device-build", "os-key-custody", "encrypted-local-db", "web-native-exchange"],
  G4: ["central-provider-registry", "live-provider-health", "clean-install", "upgrade-matrix"]
};

export interface SignedEvidenceEnvelope { payloadBase64: string; signatureBase64: string }
export interface SignedEvidencePayload {
  gate: GateName;
  revision: string;
  environment: "staging" | "production-equivalent" | "production";
  checks: GateCheck[];
}

export function verifySignedGateEvidence(envelope: SignedEvidenceEnvelope, publicKey: string, gate: GateName, revision: string): SignedEvidencePayload {
  const payloadBytes = Buffer.from(envelope.payloadBase64, "base64");
  const signature = Buffer.from(envelope.signatureBase64, "base64");
  if (!verify(null, payloadBytes, publicKey, signature)) throw new Error("EXTERNAL_EVIDENCE_SIGNATURE_INVALID");
  const payload = JSON.parse(payloadBytes.toString("utf8")) as SignedEvidencePayload;
  if (payload.gate !== gate || payload.revision !== revision) throw new Error("EXTERNAL_EVIDENCE_BINDING_INVALID");
  if (payload.environment !== "production-equivalent" && payload.environment !== "production") throw new Error("EXTERNAL_EVIDENCE_ENVIRONMENT_INVALID");
  for (const id of REQUIRED_EXTERNAL_CHECKS[gate]) {
    const check = payload.checks.find((candidate) => candidate.id === id);
    if (!check?.required || !check.passed || check.evidenceRefs.length === 0) throw new Error(`EXTERNAL_EVIDENCE_CHECK_FAILED:${id}`);
  }
  return payload;
}
