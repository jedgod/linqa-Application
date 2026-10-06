/**
 * Wire contract for the CountryLinqa discovery engine
 * (server/src/routes/countrylinqa/engine-routes.ts).
 *
 * Screens consume these shapes only. If the server renames a field, the fix
 * belongs here, not in individual screens, and the assert functions below turn
 * a silent mismatch into an explicit error instead of a blank row.
 */
export type RankedPerson = {
  id: string;
  displayName: string;
  avatarObjectKey: string | null;
  /** Null when the person hides their country. */
  verifiedCountryCode: string | null;
  verified: boolean;
  rankingScore: number;
  /** Why this person was suggested. Fixed codes, safe to map to copy. */
  reasons: string[];
  connectionStatus: "PENDING" | "ACCEPTED" | null;
};

export type PeoplePage = {
  items: RankedPerson[];
  nextCursor: string | null;
  meta: { policyVersion: number | null };
};

export type RecommendationsResponse = { items: RankedPerson[]; source: "SNAPSHOT" | "LIVE" };

export type DiscoveryFeatures = {
  languages: string[];
  interests: string[];
  professionCode: string | null;
  discoverable: boolean;
  featureVersion: number;
};

export type PeopleFilters = {
  query?: string;
  countries?: string[];
  region?: string;
  /** Matches only people who chose to show their city. */
  city?: string;
  languages?: string[];
  interests?: string[];
  profession?: string;
  verifiedOnly?: boolean;
};

export type UnifiedSearchResponse = { results: Partial<Record<"PEOPLE" | "POSTS" | "EVENTS" | "BUSINESSES" | "COMMUNITIES", unknown[]>> };

export const REASON_COPY: Record<string, string> = {
  SHARED_INTERESTS: "Shared interests",
  SHARED_LANGUAGE: "Speaks your language",
  SIMILAR_PROFESSION: "Similar profession",
  MUTUAL_CONNECTIONS: "Mutual connections",
  VERIFIED_PROFILE: "Verified profile"
};

export function reasonLabel(code: string): string {
  return REASON_COPY[code] ?? "Suggested for you";
}

export function assertPerson(value: unknown): RankedPerson {
  const row = value as Partial<RankedPerson> | null;
  if (!row || typeof row.id !== "string" || typeof row.displayName !== "string" || !Array.isArray(row.reasons)) {
    throw new Error("INVALID_COUNTRYLINQA_PERSON_CONTRACT");
  }
  return row as RankedPerson;
}

export function assertPeoplePage(value: unknown): PeoplePage {
  const page = value as Partial<PeoplePage> | null;
  if (!page || !Array.isArray(page.items)) throw new Error("INVALID_COUNTRYLINQA_PEOPLE_CONTRACT");
  page.items.forEach(assertPerson);
  return { items: page.items, nextCursor: page.nextCursor ?? null, meta: page.meta ?? { policyVersion: null } };
}
