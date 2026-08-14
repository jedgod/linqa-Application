export const G5_SUB_GATES = ["G5-A","G5-B","G5-C","G5-D","G5-E","G5-F","G5-G","G5-H","G5-I","G5-J","G5-K"] as const;
export type G5SubGate = typeof G5_SUB_GATES[number];
export type AssuranceEnvironment = "production-equivalent" | "production";
export type G5Status = "RED" | "AMBER" | "GREEN";

export interface G5Check {
  id: string;
  description: string;
  required: boolean;
  passed: boolean;
  evidenceIds: string[];
  detail?: string;
}

export interface EvidenceArtifact {
  schemaVersion: 1;
  id: string;
  type: string;
  storedPath: string;
  sha256: string;
  bytes: number;
  producedAt: string;
  producer: string;
  environment: AssuranceEnvironment;
  revision: string;
  releaseVersion: string;
  metadata?: Record<string, unknown>;
}

export interface SubmittedEvidenceArtifact extends Omit<EvidenceArtifact,"schemaVersion"|"storedPath"> { path: string }

export interface G5GateEvidence {
  schemaVersion: 1;
  gate: G5SubGate;
  status: G5Status;
  generatedAt: string;
  revision: string;
  releaseVersion: string;
  environment: AssuranceEnvironment;
  checks: G5Check[];
  summary: { required: number; passed: number; failed: number };
}

export interface G5AssurancePayload {
  schemaVersion: 1;
  revision: string;
  releaseVersion: string;
  environment: AssuranceEnvironment;
  issuedAt: string;
  expiresAt: string;
  artifacts: SubmittedEvidenceArtifact[];
  gates: Array<{ gate: G5SubGate; checks: G5Check[] }>;
}

export interface SignedG5AssuranceEnvelope { payloadBase64: string; signatureBase64: string }
