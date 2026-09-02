export type TrustStatus = "TRUSTED" | "LIMITED" | "BLOCKED" | "UNKNOWN";
export type NewsState = "LIVE" | "STALE" | "UNAVAILABLE";
export type ProviderHealthState = "HEALTHY" | "DEGRADED" | "OPEN_CIRCUIT" | "DISABLED";

export interface RawNewsArticle {
  providerName: string;
  providerArticleId?: string;
  title: string;
  url: string;
  summary?: string;
  imageUrl?: string;
  publisherName?: string;
  publisherDomain?: string;
  publishedAt: string;
  category?: string;
  countryCode?: string;
  sourceLanguage?: string;
  providerScore?: number;
  metadata?: Record<string, unknown>;
}

export interface HomeNewsItem extends RawNewsArticle {
  canonicalUrl: string;
  urlHash: string;
  publisherDomain: string;
  publisherName: string;
  category: string;
  providerScore: number;
  validationScore: number;
  trustScore: number;
  contentFingerprint: string;
  /**
   * Publisher-trust facts the client needs in order to render honestly:
   * attribution is mandatory for most licensed sources, and only publishers
   * explicitly cleared for it may be presented under a BREAKING treatment.
   */
  publisherTrustStatus: TrustStatus;
  attributionRequired: boolean;
  breakingEligible: boolean;
}

export interface NewsQuery {
  countryCode?: string;
  categories?: string[];
  limit: number;
  breakingOnly?: boolean;
}

export interface HomePreferences {
  hiddenSections: string[];
  preferredCategories: string[];
  followedCountries: string[];
  followedTopics: string[];
  quickActions: unknown[];
  personalizationEnabled: boolean;
}

/** Sections a user is allowed to hide. Anything else is rejected at the API. */
export const HIDEABLE_HOME_SECTIONS = [
  "liveUpdates",
  "spotlight",
  "upcoming",
  "continueYourDay",
  "countryLinqa",
  "breakingAroundWorld"
] as const;

export type HideableHomeSection = (typeof HIDEABLE_HOME_SECTIONS)[number];

export interface HomeFeedPayload {
  generatedAt: string;
  jurisdictionCountry: string;
  profile: unknown;
  notifications: unknown;
  quickActions: unknown[];
  liveUpdates: unknown[];
  spotlight?: unknown;
  upcoming: unknown[];
  continueYourDay: unknown[];
  vaultRecent: unknown[];
  pendingTransfers: unknown[];
  countryLinqa: unknown;
  breakingAroundWorld: HomeNewsItem[];
  serviceState: {
    news: NewsState;
    personalized: boolean;
    /**
     * Sections the user has hidden, echoed back so the client can render its
     * "unhide" affordance without a second round trip, and so an empty
     * section is distinguishable from a hidden one.
     */
    hiddenSections: string[];
    degraded: string[];
  };
}
