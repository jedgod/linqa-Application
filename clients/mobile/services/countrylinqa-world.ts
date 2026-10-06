import type { CountryLinqaCatalog, CountryLinqaPreferences } from "./countrylinqa.service";
import type { PeopleFilters, RankedPerson } from "./countrylinqa.contract";

export type PeopleTab = "FOR_YOU" | "COUNTRY" | "REGION" | "GLOBAL";
export const PEOPLE_TABS: Array<{ key: PeopleTab; label: string }> = [
  { key: "FOR_YOU", label: "For You" }, { key: "COUNTRY", label: "Country" }, { key: "REGION", label: "Region" }, { key: "GLOBAL", label: "Global" }
];

export type PersonDetail = {
  id: string;
  displayName: string;
  bio: string | null;
  verified: boolean;
  countryCode: string | null;
  countryName: string | null;
  state: string | null;
  city: string | null;
  professionCode: string | null;
  interests: string[];
  connection: { id: string; status: "PENDING" | "ACCEPTED"; incoming: boolean } | null;
};

export type WorldHome = { country: { code: string; name: string } | null; verified: boolean; trending: Array<{ tag: string; people: number }> };
export type WorldCountries = {
  yours: { code: string; name: string } | null;
  popular: Array<{ code: string; name: string; members: number }>;
  regions: Array<{ code: string; name: string; members: number }>;
};

export const flagOf = (code: string) => code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

/** "New York, USA": the city and state a person chose to show, then their country code. */
export function locationLine(p: Pick<PersonDetail, "city" | "state" | "countryCode" | "countryName">): string {
  const where = [p.city, p.city ? null : p.state].filter(Boolean);
  const country = p.countryCode === "US" ? "USA" : p.countryName ?? p.countryCode;
  return [...where, country].filter(Boolean).join(", ");
}

const SMALL = new Set(["and", "of", "the", "in", "for"]);
/** "software engineer" -> "Software Engineer"; "ui_designer" -> "Ui Designer". */
export function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").trim().split(/\s+/).map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
}

/** "Photographer • Travel": the profession, then the first interest. */
export function headline(p: Pick<PersonDetail, "professionCode" | "interests">): string {
  return [p.professionCode ? titleCase(p.professionCode) : null, p.interests[0] ? titleCase(p.interests[0]) : null].filter(Boolean).join(" • ");
}

export function connectLabel(connection: PersonDetail["connection"]): { label: string; action: "CONNECT" | "RESPOND" | "NONE" } {
  if (!connection) return { label: "Connect", action: "CONNECT" };
  if (connection.status === "ACCEPTED") return { label: "Connected", action: "NONE" };
  return connection.incoming ? { label: "Respond", action: "RESPOND" } : { label: "Request sent", action: "NONE" };
}

/**
 * What to ask the server for on each People tab. The server still applies the viewer's own
 * geographic scope, so a tab can only ever narrow what the viewer may see, never widen it.
 */
export function peopleRequest(tab: PeopleTab, ctx: { country: string | null; region: string | null }, extra: PeopleFilters = {}): { kind: "RECOMMENDED" } | { kind: "SEARCH"; filters: PeopleFilters } | { kind: "EMPTY"; reason: string } {
  if (tab === "FOR_YOU") return { kind: "RECOMMENDED" };
  if (tab === "COUNTRY") return ctx.country ? { kind: "SEARCH", filters: { ...extra, countries: [ctx.country] } } : { kind: "EMPTY", reason: "Confirm your country to see people from it." };
  if (tab === "REGION") return ctx.region ? { kind: "SEARCH", filters: { ...extra, region: ctx.region } } : { kind: "EMPTY", reason: "Your region is not known yet." };
  return { kind: "SEARCH", filters: { ...extra } };
}

/** Whether the viewer's own discovery settings reach a country (so the app can say so before opening it). */
export function reachesCountry(prefs: Pick<CountryLinqaPreferences, "mode" | "verifiedCountryCode" | "selectedCountries" | "selectedRegions">, catalog: CountryLinqaCatalog, code: string): boolean {
  if (prefs.mode === "GLOBAL") return true;
  if (code === prefs.verifiedCountryCode) return true;
  if (prefs.mode === "SELECTED_COUNTRIES") return prefs.selectedCountries.includes(code);
  if (prefs.mode === "REGION") {
    const region = catalog.countries.find((c) => c.code === code)?.regionCode;
    return !!region && prefs.selectedRegions.includes(region);
  }
  return false;
}

/** Ranked people joined with their details. Anyone the server would not describe is dropped. */
export function joinPeople(ranked: RankedPerson[], details: PersonDetail[]): Array<{ id: string; detail: PersonDetail; reasons: string[] }> {
  const byId = new Map(details.map((d) => [d.id, d]));
  return ranked.flatMap((r) => (byId.has(r.id) ? [{ id: r.id, detail: byId.get(r.id)!, reasons: r.reasons }] : []));
}

/** Countries matching a search, the viewer's own first, then A to Z. */
export function filterCountries(catalog: CountryLinqaCatalog, query: string, own: string | null) {
  const q = query.trim().toLowerCase();
  return catalog.countries
    .filter((c) => !q || `${c.name} ${c.code}`.toLowerCase().includes(q))
    .sort((a, b) => (a.code === own ? -1 : b.code === own ? 1 : a.name.localeCompare(b.name)));
}

export class ChatStartError extends Error {
  constructor(readonly code: string) { super(code); }
}

/** Opens (or finds) the direct conversation with someone. The server decides whether it may start. */
export async function startDirectChat(baseUrl: string, token: () => Promise<string>, userId: string): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/chats/direct`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ userId })
  });
  const body = (await response.json().catch(() => ({}))) as { conversationId?: string; error?: { code?: string } };
  if (!response.ok || !body.conversationId) throw new ChatStartError(body.error?.code ?? `HTTP_${response.status}`);
  return body.conversationId;
}

export type CountryHub = {
  country: { code: string; name: string; regionCode: string | null };
  inScope: boolean;
  stats: { people: number; members: number; events: number; businesses: number };
  capped: { events: boolean; businesses: boolean };
  community: { joined: boolean; suspended: boolean; available: boolean };
  trending: Array<{ tag: string; people: number }>;
  featured: PersonDetail[];
};

/** 12800 -> "12.8K", 1200000 -> "1.2M". Small numbers stay whole. */
export function formatCount(n: number, capped = false): string {
  const plus = capped ? "+" : "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M${plus}`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K${plus}`;
  return `${n}${plus}`;
}

export function membersLabel(n: number): string {
  return `${formatCount(n)} ${n === 1 ? "member" : "members"}`;
}

/** "Oct 24, 2026, 7:00 PM" in the viewer's language; empty for a date that can not be read. */
export function eventWhen(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export type EventTab = "FOR_YOU" | "WEEK" | "MONTH";
export const EVENT_TABS: Array<{ key: EventTab; label: string; period: "all" | "week" | "month" }> = [
  { key: "FOR_YOU", label: "For You", period: "all" }, { key: "WEEK", label: "This Week", period: "week" }, { key: "MONTH", label: "This Month", period: "month" }
];

/** What to ask the server for on each Communities tab. The server still applies the viewer's own reach. */
export function communityFilters(tab: PeopleTab, ctx: { country: string | null; region: string | null }): { country?: string; region?: string } | null {
  if (tab === "COUNTRY") return ctx.country ? { country: ctx.country } : null;
  if (tab === "REGION") return ctx.region ? { region: ctx.region } : null;
  return {};
}

/** Own country first (For You), then by size, then A to Z. */
export function rankCommunities<T extends { id: string; title: string; memberCount?: number }>(items: T[], ownCountry: string | null): T[] {
  return [...items].sort((a, b) => (a.id === ownCountry ? -1 : b.id === ownCountry ? 1 : (b.memberCount ?? 0) - (a.memberCount ?? 0) || a.title.localeCompare(b.title)));
}

/** "Restaurant" chips: the categories that exist in what was loaded, most common first. */
export function categoryChips(categories: Array<string | undefined>): string[] {
  const counts = new Map<string, number>();
  for (const c of categories) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}
