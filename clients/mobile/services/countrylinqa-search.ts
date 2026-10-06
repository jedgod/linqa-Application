import type { PeopleFilters } from "./countrylinqa.contract";
import { titleCase } from "./countrylinqa-world";

export type SearchKind = "people" | "businesses" | "events";
export type SearchSort = "RELEVANT" | "NAME";
export const SORTS: Array<{ key: SearchSort; label: string }> = [{ key: "RELEVANT", label: "Most Relevant" }, { key: "NAME", label: "Name (A to Z)" }];

/** Interest and language choices offered in the pickers. Matches what people can put on their discovery profile. */
export const INTEREST_OPTIONS = ["technology", "travel", "education", "business", "music", "sports", "culture", "photography", "entertainment", "food", "art", "health"];
export const LANGUAGE_OPTIONS = ["english", "french", "spanish", "arabic", "twi", "japanese", "portuguese", "swahili", "yoruba", "hausa"];

/** Everything on the Advanced Search and Filters screens. Empty means "any". */
export interface SearchState {
  kind: SearchKind;
  query: string;
  country: string;
  region: string;
  city: string;
  interests: string[];
  languages: string[];
  profession: string;
  verifiedOnly: boolean;
  category: string;
  sort: SearchSort;
}

export const emptySearch = (kind: SearchKind = "people"): SearchState => ({
  kind, query: "", country: "", region: "", city: "", interests: [], languages: [], profession: "", verifiedOnly: true, category: "", sort: "RELEVANT"
});

/** The request body for the ranked people search. The server still applies the viewer's own reach. */
export function toPeopleFilters(s: SearchState): PeopleFilters & { city?: string } {
  return {
    ...(s.query.trim() ? { query: s.query.trim() } : {}),
    ...(s.country ? { countries: [s.country] } : {}),
    ...(s.region ? { region: s.region } : {}),
    ...(s.city.trim() ? { city: s.city.trim() } : {}),
    ...(s.interests.length ? { interests: s.interests } : {}),
    ...(s.languages.length ? { languages: s.languages } : {}),
    ...(s.profession.trim() ? { profession: s.profession.trim().toLowerCase() } : {}),
    verifiedOnly: s.verifiedOnly
  };
}

/** The query for the business and event lists, which understand fewer filters than people do. */
export function toCollectionFilters(s: SearchState) {
  return {
    ...(s.query.trim() ? { q: s.query.trim() } : {}),
    ...(s.country ? { country: s.country } : {}),
    ...(s.region ? { region: s.region } : {}),
    ...(s.kind === "businesses" && s.category ? { category: s.category } : {})
  };
}

/** What gets stored for a saved people search. */
export function toSavedFilters(s: SearchState) {
  return {
    ...(s.query.trim() ? { q: s.query.trim() } : {}),
    ...(s.country ? { country: s.country } : {}),
    ...(s.region ? { region: s.region } : {}),
    ...(s.city.trim() ? { city: s.city.trim() } : {}),
    ...(s.interests.length ? { interests: s.interests } : {}),
    ...(s.languages.length ? { languages: s.languages } : {}),
    ...(s.profession.trim() ? { profession: s.profession.trim().toLowerCase() } : {}),
    verifiedOnly: s.verifiedOnly
  };
}

const strings = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : []);

/** Reads either shape of saved filters (the original single `language`, or the newer lists). Anything unknown is ignored. */
export function fromSavedFilters(raw: unknown): SearchState {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (k: string) => (typeof f[k] === "string" ? (f[k] as string) : "");
  const languages = strings(f.languages, 10);
  if (typeof f.language === "string" && f.language && !languages.includes(f.language)) languages.push(f.language);
  return { ...emptySearch("people"), query: text("q"), country: text("country"), region: text("region"), city: text("city"), interests: strings(f.interests, 20), languages, profession: text("profession"), verifiedOnly: typeof f.verifiedOnly === "boolean" ? f.verifiedOnly : true };
}

/** Round-trips the state through a route parameter. */
export const encodeSearch = (s: SearchState) => JSON.stringify(s);
export function decodeSearch(value: string | undefined, fallbackKind: SearchKind = "people"): SearchState {
  try {
    const p = JSON.parse(value ?? "{}") as Partial<SearchState>;
    const base = emptySearch(p.kind === "businesses" || p.kind === "events" || p.kind === "people" ? p.kind : fallbackKind);
    const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 100) : "");
    return {
      ...base, query: text(p.query), country: text(p.country).toUpperCase().slice(0, 2), region: text(p.region), city: text(p.city),
      interests: strings(p.interests, 20), languages: strings(p.languages, 10), profession: text(p.profession),
      verifiedOnly: typeof p.verifiedOnly === "boolean" ? p.verifiedOnly : true, category: text(p.category),
      sort: p.sort === "NAME" ? "NAME" : "RELEVANT"
    };
  } catch { return emptySearch(fallbackKind); }
}

/** How many filters are narrowing the search (the Filter button badge). Sorting and verified-only do not count. */
export function activeFilterCount(s: SearchState): number {
  return [s.country, s.region, s.city.trim(), s.profession.trim(), s.category].filter(Boolean).length + (s.interests.length ? 1 : 0) + (s.languages.length ? 1 : 0);
}

/** A short line describing the search, for the results header and saved searches. */
export function describeSearch(s: SearchState, names: { country?: string; region?: string } = {}): string {
  return [
    s.query.trim() && `"${s.query.trim()}"`, names.country ?? (s.country || null), names.region ?? (s.region || null), s.city.trim() || null,
    s.interests.length ? s.interests.map(titleCase).join(", ") : null, s.languages.length ? s.languages.map(titleCase).join(", ") : null,
    s.profession.trim() ? titleCase(s.profession.trim()) : null, s.category ? titleCase(s.category) : null
  ].filter(Boolean).join(" · ") || "Everyone in your discovery scope";
}

/** Sorting applies to what has been loaded. "Most relevant" keeps the server order. */
export function sortRows<T extends { name: string }>(rows: T[], sort: SearchSort): T[] {
  return sort === "NAME" ? [...rows].sort((a, b) => a.name.localeCompare(b.name)) : rows;
}

/** "Last used today", "yesterday", "2 days ago", "1 week ago"; never-used searches say "Never used". */
export function lastUsedLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "Never used";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "Never used";
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / 86_400_000);
  if (days <= 0) return "Last used today";
  if (days === 1) return "Last used yesterday";
  if (days < 7) return `Last used ${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `Last used ${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `Last used ${months} ${months === 1 ? "month" : "months"} ago` : "Last used over a year ago";
}

// The Filters screen hands its result back to the Search Results screen that opened it through this
// one-slot hand-off, so going back does not leave a stale copy of the results on the stack.
let pending: SearchState | null = null;
export const setPendingSearch = (state: SearchState) => { pending = state; };
export function takePendingSearch(): SearchState | null { const value = pending; pending = null; return value; }
