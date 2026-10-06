export type ViewerFeatures = { languages: string[]; interests: string[]; professionCode: string | null };

export type RankCandidate = {
  userId: string;
  languages: string[];
  interests: string[];
  professionCode: string | null;
  verified: boolean;
  mutualConnections: number;
  profileQuality: number;
  safetyQuality: number;
  freshness: number;
};

export type RankedCandidate = RankCandidate & { score: number; reasons: string[] };

const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(b.map((x) => x.toLowerCase()));
  return a.filter((x) => set.has(x.toLowerCase())).length / Math.max(a.length, b.length);
}

/**
 * Scores an already-eligible candidate.
 *
 * Geography is intentionally absent from the weights: eligibility is a hard
 * gate applied before ranking, so a high score can never pull in a person the
 * viewer's or the candidate's policy excludes. Scores are rounded so ordering
 * is identical across processes.
 */
export function rankCandidate(viewer: ViewerFeatures, c: RankCandidate): RankedCandidate {
  const interest = overlap(viewer.interests, c.interests);
  const language = overlap(viewer.languages, c.languages);
  const profession = viewer.professionCode && c.professionCode === viewer.professionCode ? 1 : 0;
  const mutual = clamp(c.mutualConnections / 10);
  const score =
    interest * 0.25 + language * 0.15 + profession * 0.1 + mutual * 0.18 +
    clamp(c.profileQuality) * 0.1 + clamp(c.safetyQuality) * 0.17 + clamp(c.freshness) * 0.05;
  const reasons: string[] = [];
  if (interest >= 0.2) reasons.push("SHARED_INTERESTS");
  if (language >= 0.2) reasons.push("SHARED_LANGUAGE");
  if (profession) reasons.push("SIMILAR_PROFESSION");
  if (mutual > 0) reasons.push("MUTUAL_CONNECTIONS");
  if (c.verified) reasons.push("VERIFIED_PROFILE");
  return { ...c, score: Math.round(score * 1e6) / 1e6, reasons };
}

/** Deterministic order: score descending, then id, so equal scores cannot reshuffle between requests. */
export function rankAll(viewer: ViewerFeatures, candidates: RankCandidate[]): RankedCandidate[] {
  return candidates
    .map((c) => rankCandidate(viewer, c))
    .sort((a, b) => b.score - a.score || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

/**
 * Stops one profession filling a page. Over-represented candidates are
 * deferred to a later window, not dropped, so paging through the whole list
 * still reaches everyone exactly once.
 */
export function diversify(ranked: RankedCandidate[], windowSize: number): RankedCandidate[] {
  const cap = Math.max(3, Math.ceil(windowSize * 0.35));
  const out: RankedCandidate[] = [];
  let pending = ranked;
  while (pending.length) {
    const counts = new Map<string, number>();
    const deferred: RankedCandidate[] = [];
    let taken = 0;
    for (const c of pending) {
      const key = c.professionCode ?? "NONE";
      if (taken < windowSize && (counts.get(key) ?? 0) < cap) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        out.push(c);
        taken++;
      } else {
        deferred.push(c);
      }
    }
    // Only capped candidates remain: they fill the window rather than stall it.
    if (taken === 0) {
      out.push(...deferred);
      break;
    }
    pending = deferred;
  }
  return out;
}
