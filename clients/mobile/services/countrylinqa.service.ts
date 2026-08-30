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
  subscriptionTier: "FREE" | "PREMIUM" | "ELITE";
  allowedModes: Record<DiscoveryMode, boolean>;
  selectionLimits: { countries: number; regions: number };
};
export type CountryPreferences = CountryLinqaPreferences;

export type StepUpChallenge = { challengeId: string; challenge: string; expiresAt: string };
type ItemsResponse<T = Record<string, unknown>> = { items: T[]; nextCursor?: string | null };

/**
 * Real client for `server/src/routes/countrylinqa/*` — a 1:1 port of the
 * real `com.linqa.app.network.CountryLinqaApi` Kotlin class (same method
 * names, same endpoints), not the pack's standalone Express service. Kept
 * in sync with the Android client by
 * `certification/countrylinqa/check_mobile_parity.py`.
 */
export class CountryLinqaService {
  constructor(private readonly baseUrl: string, private readonly token: () => Promise<string>) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        authorization: `Bearer ${await this.token()}`,
        ...(init.headers ?? {})
      }
    });
    const payload = await response.json().catch(() => ({}));
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

  discoverUsers(query: { country?: string; region?: string; verifiedOnly?: boolean } = {}) {
    const params = new URLSearchParams(query as Record<string, string>).toString();
    return this.request<ItemsResponse>(`/v1/countrylinqa/discover/users${params ? `?${params}` : ""}`);
  }

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
    return this.request<Record<string, unknown>>(`/v1/countrylinqa/communities/country/${code}/join`, { method: "POST" });
  }

  leaveCountryCommunity(code: string) {
    return this.request<Record<string, unknown>>(`/v1/countrylinqa/communities/country/${code}/leave`, { method: "POST" });
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
