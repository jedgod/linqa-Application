export type Candidate = {
  id: string;
  type: "USER" | "POST" | "BUSINESS" | "EVENT" | "COMMUNITY";
  countryCode?: string | null;
  regionCode?: string | null;
  verified?: boolean;
  engagementScore?: number;
  freshnessScore?: number;
  affinityScore?: number;
  qualityScore?: number;
  safetyPenalty?: number;
};

export function rankCandidate(c: Candidate): number {
  return (
    (c.engagementScore ?? 0) * 0.3 +
    (c.freshnessScore ?? 0) * 0.2 +
    (c.affinityScore ?? 0) * 0.3 +
    (c.qualityScore ?? 0) * 0.2 +
    (c.verified ? 0.15 : 0) -
    (c.safetyPenalty ?? 0)
  );
}

export function rankCandidates<T extends Candidate>(items: T[]): T[] {
  return [...items].sort((a, b) => rankCandidate(b) - rankCandidate(a));
}
