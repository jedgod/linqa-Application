import type { ChatReachMode, CountryLinqaCatalog, CountryLinqaPreferences, DiscoveryMode, InboundReach } from "./countrylinqa.service";

type Prefs = CountryLinqaPreferences;
const nameOf = (catalog: CountryLinqaCatalog, code: string) => catalog.countries.find((c) => c.code === code)?.name ?? code;
const regionName = (catalog: CountryLinqaCatalog, code: string) => catalog.regions.find((r) => r.code === code)?.name ?? code;

function summarize(mode: string, countries: string[], regions: string[], own: string, catalog: CountryLinqaCatalog, regionLabel: string | null): string {
  if (mode === "MY_COUNTRY") return own;
  if (mode === "SELECTED_COUNTRIES") return countries.length === 1 ? nameOf(catalog, countries[0]!) : `${countries.length} countries`;
  if (mode === "REGION") return regions.length === 1 ? regionName(catalog, regions[0]!) : regions.length > 1 ? `${regions.length} regions` : regionLabel ?? "My region";
  if (mode === "GLOBAL" || mode === "WORLDWIDE") return "Worldwide";
  if (mode === "CONTACTS_ONLY" || mode === "EXISTING_CONTACTS_ONLY") return "Existing contacts only";
  if (mode === "NOBODY") return "Nobody";
  return mode;
}

/** The one-line values on Settings Home: "United States", "3 countries", "Worldwide". */
export function reachSummaries(prefs: Prefs, catalog: CountryLinqaCatalog) {
  const own = prefs.verifiedCountryCode ? nameOf(catalog, prefs.verifiedCountryCode) : "Your country";
  const ownRegion = catalog.countries.find((c) => c.code === prefs.verifiedCountryCode)?.regionCode;
  const regionLabel = ownRegion ? regionName(catalog, ownRegion) : null;
  return {
    discover: summarize(prefs.mode, prefs.selectedCountries, prefs.selectedRegions, own, catalog, regionLabel),
    discoverMe: summarize(prefs.inboundReach, prefs.inboundSelectedCountries, prefs.inboundSelectedRegions, own, catalog, regionLabel),
    chatMe: summarize(prefs.chatReachMode, prefs.chatSelectedCountries, prefs.chatRegionCode ? [prefs.chatRegionCode] : [], own, catalog, regionLabel)
  };
}

/** Countries the viewer discovers: their own, plus any they chose. Used for the list on Manage Countries. */
export function discoveredCountries(prefs: Prefs): string[] {
  const own = prefs.verifiedCountryCode ? [prefs.verifiedCountryCode] : [];
  return prefs.mode === "SELECTED_COUNTRIES" ? [...own, ...prefs.selectedCountries.filter((c) => c !== prefs.verifiedCountryCode)] : own;
}

export type SaveOverrides = Partial<Pick<Prefs, "mode" | "selectedCountries" | "selectedRegions" | "inboundReach" | "inboundSelectedCountries" | "inboundSelectedRegions" | "showCountry" | "showState" | "showCity" | "verifiedOnly" | "allowBusinesses" | "allowCommunities" | "allowEvents" | "paused" | "chatReachMode" | "chatSelectedCountries" | "chatExistingContactsBypass">>;

/**
 * The full save request for the current settings with some values changed. The server replaces a
 * setting from what it is sent, so every screen builds its request here rather than sending a fragment.
 * Chosen countries are sent only for the mode that uses them.
 */
export function savePayload(prefs: Prefs, over: SaveOverrides = {}) {
  const v = { ...prefs, ...over };
  return {
    mode: v.mode as DiscoveryMode,
    selectedCountries: v.mode === "SELECTED_COUNTRIES" ? v.selectedCountries : [],
    selectedRegions: v.mode === "REGION" ? v.selectedRegions : [],
    inboundReach: v.inboundReach as InboundReach,
    inboundSelectedCountries: v.inboundReach === "SELECTED_COUNTRIES" ? v.inboundSelectedCountries : [],
    inboundSelectedRegions: v.inboundReach === "REGION" ? v.inboundSelectedRegions : [],
    showCountry: v.showCountry, showState: v.showState,
    locationPrecision: (v.showCity ? "CITY" : v.showState ? "STATE" : "COUNTRY") as "CITY" | "STATE" | "COUNTRY",
    showCity: v.showCity,
    verifiedOnly: v.verifiedOnly, allowBusinesses: v.allowBusinesses, allowCommunities: v.allowCommunities, allowEvents: v.allowEvents,
    paused: v.paused,
    chatReach: {
      mode: v.chatReachMode as ChatReachMode,
      ...(v.chatReachMode === "SELECTED_COUNTRIES" ? { selectedCountries: v.chatSelectedCountries } : {}),
      existingContactsBypass: v.chatExistingContactsBypass
    },
    expectedVersion: prefs.version
  };
}

export const PLAN_COPY: Record<Prefs["subscriptionTier"], { name: string; reach: string; upgrade: string | null }> = {
  FREE: { name: "Free", reach: "My Country only", upgrade: "Upgrade to explore more countries and connect globally." },
  PREMIUM: { name: "Premium", reach: "Selected countries and regions", upgrade: "Upgrade to Elite to explore worldwide." },
  ELITE: { name: "Elite", reach: "Worldwide", upgrade: null }
};

/** Where "Manage Subscription" goes. Store subscriptions are managed in the store; anything else goes to support. */
export function manageSubscriptionTarget(provider: "APPLE" | "GOOGLE" | "STRIPE" | "MANUAL" | null): { kind: "URL"; url: string } | { kind: "SUPPORT" } | { kind: "NONE" } {
  if (!provider) return { kind: "NONE" };
  if (provider === "APPLE") return { kind: "URL", url: "https://apps.apple.com/account/subscriptions" };
  if (provider === "GOOGLE") return { kind: "URL", url: "https://play.google.com/store/account/subscriptions" };
  return { kind: "SUPPORT" };
}

export function renewalLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
