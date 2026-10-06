/**
 * Pure reference model of CountryLinqa's mutual-exposure rule.
 *
 * Production eligibility is enforced in SQL (feed-scope.ts), where it is
 * applied before ranking and pagination. This module states the same rule as
 * a function so the rule is testable without a database and so the SQL can be
 * compared against it case by case (see countrylinqa-engine.test.ts). If the
 * two ever disagree, the SQL is wrong.
 *
 * Rule: a candidate is shown to a viewer only if BOTH sides allow it, and a
 * block or safety restriction overrides every geographic mode.
 */
export type OutboundMode = "MY_COUNTRY" | "SELECTED_COUNTRIES" | "REGION" | "GLOBAL";
export type InboundMode = OutboundMode | "CONTACTS_ONLY";

/** Region code -> member country codes, resolved from the countries table. */
export type RegionCountries = Readonly<Record<string, readonly string[]>>;

export interface ViewerPolicy {
  verifiedCountryCode: string;
  verified: boolean;
  outboundMode: OutboundMode;
  selectedCountries: readonly string[];
  selectedRegions: readonly string[];
  verifiedOnly: boolean;
  paused: boolean;
}

export interface CandidatePolicy {
  verifiedCountryCode: string;
  verified: boolean;
  inboundMode: InboundMode;
  inboundCountries: readonly string[];
  inboundRegions: readonly string[];
  paused: boolean;
  discoverable: boolean;
  restricted: boolean;
}

export interface Relationship {
  isExistingContact: boolean;
  isBlocked: boolean;
}

const regionIncludes = (regions: readonly string[], regionCountries: RegionCountries, country: string) =>
  regions.some((region) => regionCountries[region]?.includes(country));

export function viewerReaches(viewer: ViewerPolicy, candidateCountry: string, regionCountries: RegionCountries): boolean {
  switch (viewer.outboundMode) {
    case "GLOBAL": return true;
    case "MY_COUNTRY": return candidateCountry === viewer.verifiedCountryCode;
    case "SELECTED_COUNTRIES": return viewer.selectedCountries.includes(candidateCountry);
    case "REGION": return regionIncludes(viewer.selectedRegions, regionCountries, candidateCountry);
  }
}

export function candidateAccepts(
  candidate: CandidatePolicy,
  viewerCountry: string,
  isExistingContact: boolean,
  regionCountries: RegionCountries
): boolean {
  switch (candidate.inboundMode) {
    case "GLOBAL": return true;
    case "MY_COUNTRY": return candidate.verifiedCountryCode === viewerCountry;
    case "SELECTED_COUNTRIES": return candidate.inboundCountries.includes(viewerCountry);
    case "REGION": return regionIncludes(candidate.inboundRegions, regionCountries, viewerCountry);
    case "CONTACTS_ONLY": return isExistingContact;
  }
}

export function canExposePerson(input: {
  viewer: ViewerPolicy;
  candidate: CandidatePolicy;
  relationship: Relationship;
  regionCountries: RegionCountries;
}): boolean {
  const { viewer, candidate, relationship, regionCountries } = input;
  if (relationship.isBlocked || candidate.restricted) return false;
  if (viewer.paused || !viewer.verified) return false;
  if (candidate.paused || !candidate.discoverable) return false;
  if (viewer.verifiedOnly && !candidate.verified) return false;
  if (!viewerReaches(viewer, candidate.verifiedCountryCode, regionCountries)) return false;
  return candidateAccepts(candidate, viewer.verifiedCountryCode, relationship.isExistingContact, regionCountries);
}
