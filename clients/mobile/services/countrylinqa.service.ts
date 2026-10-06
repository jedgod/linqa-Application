import { assertPeoplePage, assertPerson, type DiscoveryFeatures, type PeopleFilters, type RecommendationsResponse, type UnifiedSearchResponse } from "./countrylinqa.contract";
export type CountryLinqaCountry = { code: string; name: string; callingCode: string | null; regionCode: string | null };
export type CountryLinqaRegion = { code: string; name: string; parentCode: string | null };
export type CountryLinqaCatalog = { countries: CountryLinqaCountry[]; regions: CountryLinqaRegion[] };
// Aliases matching the real consumer screens (app/settings/countrylinqa.tsx,
// app/countrylinqa/list.tsx), which predate this rewrite of the service.
export type CountryCatalog = CountryLinqaCatalog;

export type DiscoveryMode = "MY_COUNTRY" | "SELECTED_COUNTRIES" | "REGION" | "GLOBAL";
export type CountryMode = DiscoveryMode;
export type InboundReach = DiscoveryMode | "CONTACTS_ONLY";

export type CountryLinqaPreferences = {
  mode: DiscoveryMode;
  verifiedCountryCode: string | null;
  verificationState: string;
  selectedCountries: string[];
  selectedRegions: string[];
  inboundReach: InboundReach;
  inboundSelectedCountries: string[];
  inboundSelectedRegions: string[];
  locationPrecision: "COUNTRY" | "STATE" | "CITY";
  showCity: boolean;
  showState: boolean;
  showCountry: boolean;
  verifiedOnly: boolean;
  allowBusinesses: boolean;
  allowCommunities: boolean;
  allowEvents: boolean;
  paused: boolean;
  /** Bumped on every save. Send it back as `expectedVersion` so a stale screen cannot overwrite newer settings. */
  version: number;
  subscriptionTier: "FREE" | "PREMIUM" | "ELITE";
  allowedModes: Record<DiscoveryMode, boolean>;
  selectionLimits: { countries: number; regions: number };
};
export type CountryPreferences = CountryLinqaPreferences;

export type StepUpChallenge = { challengeId: string; challenge: string; expiresAt: string };
export type ItemsResponse<T = Record<string, unknown>> = { items: T[]; nextCursor?: string | null; nextOffset?: number | null };
export type CountryCollection = "feed" | "people" | "businesses" | "events" | "communities";
export type CountrySearch = { q?: string; country?: string; region?: string; language?: string; verifiedOnly?: boolean };
export type CountryPagination = { cursor?: string; offset?: number; limit?: number };
export type CountryItem = { id: string; title: string; detail: string; body?: string; countryCode?: string; startsAt?: string; createdAt?: string; category?: string; joined?: boolean; suspended?: boolean; memberCount?: number; connectionStatus?: string; connectionIncoming?: boolean };
export type CountryConnection = { id: string; status: "PENDING" | "ACCEPTED"; displayName: string; incoming: boolean };
export type SavedCountrySearch = { id: string; name: string; filters: CountrySearch; createdAt: string; alertsEnabled?: boolean };
export type CountryNotificationPreferences = { countryTrends: boolean; regionalTrends: boolean; selectedCountryActivity: boolean; countryEvents: boolean; countryBusinesses: boolean; securityAlerts: boolean; digestFrequency: "OFF" | "DAILY" | "WEEKLY" };
export type CountryNotification = { id: string; notificationType: string; payload: Record<string, unknown>; createdAt: string };
export type CountryProfile = { id: string; displayName: string; bio: string; verifiedCountryCode: string | null; verificationState: string };
export type CountrySecurityEvent = { id: string; eventType: string; severity: string; createdAt: string };

function queryString(query: object) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== "") params.set(key, String(value)); });
  return params.size ? `?${params}` : "";
}

/** Normalize the existing wire names without changing Android's API contract. */
export function countryItem(kind: CountryCollection, row: Record<string, unknown>): CountryItem {
  const country = row.countryCode ?? row.verified_country_code;
  const text = (value: unknown) => typeof value === "string" ? value : "";
  const title = kind === "people" ? text(row.display_name ?? row.displayName) : kind === "feed" ? text(row.body) : text(row.title ?? row.name);
  return {
    id: text(row.id ?? row.code), title: title || (kind === "people" ? "Linqa member" : "Untitled"),
    detail: kind === "people" ? text(country) : kind === "businesses" ? text(row.category) : kind === "communities" ? `${Number(row.memberCount ?? 0)} members` : text(row.city ?? country),
    ...(kind === "feed" ? { body: text(row.body) } : {}),
    ...(typeof country === "string" ? { countryCode: country } : {}),
    ...(typeof row.startsAt === "string" ? { startsAt: row.startsAt } : {}),
    ...(typeof row.createdAt === "string" ? { createdAt: row.createdAt } : {}),
    ...(typeof row.category === "string" ? { category: row.category } : {}),
    ...(typeof row.connectionStatus === "string" ? { connectionStatus: row.connectionStatus, connectionIncoming: row.connectionIncoming === true } : {}),
    ...(kind === "communities" ? { joined: row.joined === true || row.status === "ACTIVE", suspended: row.suspended === true, memberCount: Number(row.memberCount ?? 0) } : {})
  };
}

/**
 * Real client for `server/src/routes/countrylinqa/*` — a 1:1 port of the
 * real `com.linqa.app.network.CountryLinqaApi` Kotlin class (same method
 * names, same endpoints), not the pack's standalone Express service. Kept
 * in sync with the Android client by
 * `certification/countrylinqa/check_mobile_parity.py`.
 */
export class CountryLinqaService {
  constructor(private readonly baseUrl: string, private readonly token: () => Promise<string>, private readonly isCurrent: () => boolean = () => true) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.isCurrent()) throw new Error("Account changed. Reopen CountryLinqa to continue.");
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        authorization: `Bearer ${await this.token()}`,
        ...(init.headers ?? {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!this.isCurrent()) throw new Error("Account changed. Reopen CountryLinqa to continue.");
    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : "CountryLinqa request failed";
      throw new Error(message);
    }
    return payload as T;
  }

  catalog() {
    return this.request<CountryLinqaCatalog>("/v1/countrylinqa/catalog");
  }

  preferences() {
    return this.request<CountryLinqaPreferences>("/v1/countrylinqa/preferences");
  }

  savePreferences(input: {
    mode: DiscoveryMode;
    selectedCountries?: string[];
    selectedRegions?: string[];
    locationPrecision?: "COUNTRY" | "STATE" | "CITY";
    showCity?: boolean;
    inboundReach?: InboundReach;
    inboundSelectedCountries?: string[];
    inboundSelectedRegions?: string[];
    showState?: boolean;
    showCountry?: boolean;
    verifiedOnly?: boolean;
    allowBusinesses?: boolean;
    allowCommunities?: boolean;
    allowEvents?: boolean;
    paused?: boolean;
    expectedVersion?: number;
  }) {
    return this.request<CountryLinqaPreferences>("/v1/countrylinqa/preferences", {
      method: "PUT",
      body: JSON.stringify(input)
    });
  }

  /** Alias for savePreferences — matches app/settings/countrylinqa.tsx's naming. */
  save(input: Parameters<CountryLinqaService["savePreferences"]>[0]) {
    return this.savePreferences(input);
  }

  worldFeed(cursor?: string) {
    return this.request<ItemsResponse>(`/v1/countrylinqa/golive/feed${cursor ? `?cursor=${cursor}` : ""}`);
  }

  businesses() {
    return this.request<ItemsResponse>("/v1/countrylinqa/golive/businesses");
  }

  events() {
    return this.request<ItemsResponse>("/v1/countrylinqa/golive/events");
  }

  createPost(body: string) {
    return this.request<{ id: string; createdAt: string }>("/v1/countrylinqa/golive/posts", {
      method: "POST",
      body: JSON.stringify({ body })
    });
  }

  createEvent(input: { title: string; startsAt: string; city?: string }) {
    return this.request<{ id: string; startsAt: string }>("/v1/countrylinqa/golive/events", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  discoverUsers(query: CountrySearch & CountryPagination = {}) {
    return this.request<ItemsResponse>(`/v1/countrylinqa/discover/users${queryString(query)}`);
  }

  async collection(kind: CountryCollection, filters: CountrySearch & { category?: string; period?: "all" | "week" | "month"; joinedOnly?: boolean } = {}, page: CountryPagination = {}) {
    const { q, country, region, language, verifiedOnly, category, period } = filters;
    const { cursor, offset, limit } = page;
    const path = kind === "people" ? "/v1/countrylinqa/discover/users" : kind === "communities" ? filters.joinedOnly ? "/v1/countrylinqa/communities/mine" : "/v1/countrylinqa/communities/discover" : `/v1/countrylinqa/golive/${kind}`;
    const query = kind === "people" ? { q, country, region, language, verifiedOnly, cursor, limit }
      : kind === "feed" ? { q, country, cursor, limit } : { q, country, region, ...(kind === "businesses" ? { category } : {}), ...(kind === "events" ? { period } : {}), offset, limit };
    const result = await this.request<ItemsResponse>(`${path}${kind === "communities" && filters.joinedOnly ? "" : queryString(query)}`);
    return { ...result, items: result.items.map(row => countryItem(kind, row)) };
  }

  /** Ranked, policy-filtered people. Filters only narrow the result; they never widen the server's scope. */
  async searchPeople(filters: PeopleFilters = {}, page: { limit?: number; cursor?: string } = {}) {
    return assertPeoplePage(await this.request<unknown>("/v1/countrylinqa/discover/people/search", {
      method: "POST", body: JSON.stringify({ filters, ...page })
    }));
  }
  async recommendedPeople() {
    const result = await this.request<RecommendationsResponse>("/v1/countrylinqa/recommendations/people");
    result.items.forEach(assertPerson);
    return result;
  }
  unifiedSearch(q: string, types?: Array<"PEOPLE" | "POSTS" | "EVENTS" | "BUSINESSES" | "COMMUNITIES">, limit = 10) {
    return this.request<UnifiedSearchResponse>(`/v1/countrylinqa/search${queryString({ q, types: types?.join(","), limit })}`);
  }
  discoveryFeatures() { return this.request<DiscoveryFeatures>("/v1/countrylinqa/discovery/features"); }
  saveDiscoveryFeatures(input: Omit<DiscoveryFeatures, "featureVersion">) {
    return this.request<DiscoveryFeatures>("/v1/countrylinqa/discovery/features", { method: "PUT", body: JSON.stringify(input) });
  }
  setSavedSearchAlerts(id: string, alertsEnabled: boolean) {
    return this.request<{ id: string; alertsEnabled: boolean }>(`/v1/countrylinqa/saved-searches/${encodeURIComponent(id)}/alerts`, { method: "PATCH", body: JSON.stringify({ alertsEnabled }) });
  }

  savedSearches() { return this.request<ItemsResponse<SavedCountrySearch>>("/v1/countrylinqa/saved-searches"); }
  saveSearch(name: string, filters: CountrySearch) {
    return this.request<SavedCountrySearch>("/v1/countrylinqa/saved-searches", { method: "POST", body: JSON.stringify({ name, filters }) });
  }
  deleteSavedSearch(id: string) { return this.request<{ deleted: boolean }>(`/v1/countrylinqa/saved-searches/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  notificationPreferences() { return this.request<CountryNotificationPreferences>("/v1/countrylinqa/notifications/preferences"); }
  saveNotificationPreferences(input: CountryNotificationPreferences) {
    return this.request<CountryNotificationPreferences>("/v1/countrylinqa/notifications/preferences", { method: "PUT", body: JSON.stringify(input) });
  }
  notifications() { return this.request<ItemsResponse<CountryNotification>>("/v1/countrylinqa/notifications"); }
  profile() { return this.request<CountryProfile>("/v1/countrylinqa/profile"); }
  saveProfile(input: { displayName: string; bio: string }) { return this.request<CountryProfile>("/v1/countrylinqa/profile", { method: "PUT", body: JSON.stringify(input) }); }
  securityActivity() { return this.request<ItemsResponse<CountrySecurityEvent>>("/v1/countrylinqa/security/activity"); }
  report(input: { subjectType: "USER" | "POST" | "EVENT" | "BUSINESS"; subjectId: string; reason: "SPAM" | "FRAUD" | "ABUSE" | "OTHER"; details: string }) {
    return this.request<{ reported: boolean }>("/v1/countrylinqa/reports", { method: "POST", body: JSON.stringify(input) });
  }
  connect(id: string) { return this.request<{ id: string; status: string }>(`/v1/countrylinqa/discover/users/${encodeURIComponent(id)}/connect`, { method: "POST" }); }
  connections() { return this.request<ItemsResponse<CountryConnection>>("/v1/countrylinqa/connections"); }
  resolveConnection(id: string, action: "ACCEPT" | "DECLINE" | "CANCEL") { return this.request<{ id: string; status: string }>(`/v1/countrylinqa/connections/${encodeURIComponent(id)}/resolve`, { method: "POST", body: JSON.stringify({ action }) }); }

  confirmCountry(claimedCountryCode: string) {
    return this.request<{
      verifiedCountryCode: string;
      claimedCountryCode: string;
      verificationState: string;
      riskScore: number;
      reviewRequired: boolean;
    }>("/v1/countrylinqa/verification/confirm-country", { method: "POST", body: JSON.stringify({ claimedCountryCode }) });
  }

  requestCountryClarification(proposedCountryCode?: string) {
    return this.request<{ reviewRequired: true; detectedCountryCode: string; proposedCountryCode: string | null }>(
      "/v1/countrylinqa/verification/request-clarification",
      { method: "POST", body: JSON.stringify({ ...(proposedCountryCode ? { proposedCountryCode } : {}) }) }
    );
  }

  feedScope() {
    return this.request<Record<string, unknown>>("/v1/countrylinqa/feed/scope");
  }

  communitiesMine() {
    return this.request<ItemsResponse>("/v1/countrylinqa/communities/mine");
  }

  joinCountryCommunity(code: string) {
    return this.request<Record<string, unknown>>(`/v1/countrylinqa/communities/country/${encodeURIComponent(code)}/join`, { method: "POST" });
  }

  leaveCountryCommunity(code: string) {
    return this.request<Record<string, unknown>>(`/v1/countrylinqa/communities/country/${encodeURIComponent(code)}/leave`, { method: "POST" });
  }

  createStepUpChallenge(purpose: string) {
    return this.request<StepUpChallenge>("/v1/countrylinqa/security/stepup/challenge", {
      method: "POST",
      body: JSON.stringify({ purpose })
    });
  }

  consumeStepUpChallenge(input: { challengeId: string; challenge: string; purpose: string }) {
    return this.request<void>("/v1/countrylinqa/security/stepup/consume", { method: "POST", body: JSON.stringify(input) });
  }

  reverify(input: { deviceId: string; stepUpChallengeId: string; stepUpChallenge: string }) {
    return this.request<Record<string, unknown>>("/v1/countrylinqa/verification/reverify", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }
}
