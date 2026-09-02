/**
 * Client for the aggregated production Home API
 * (`server/src/home/home.routes.ts`).
 *
 * This replaces `MobileHubService.loadHomeFeed()`, which spoke to the older
 * `/v1/mobile/home` handler in `routes/mobile-hub.ts`. The payload is not
 * shape-compatible: it carries publisher trust and attribution, an explicit
 * per-section degradation list, user-controlled section visibility, and a
 * server-authoritative jurisdiction.
 *
 * Fail-honest is the whole point of the contract: `serviceState.news` is
 * LIVE / STALE / UNAVAILABLE, and the UI is expected to say which. There is no
 * client-side placeholder content.
 */

export type HomeNewsState = "LIVE" | "STALE" | "UNAVAILABLE";
export type PublisherTrustStatus = "TRUSTED" | "LIMITED" | "BLOCKED" | "UNKNOWN";

export const HIDEABLE_HOME_SECTIONS = [
  "liveUpdates",
  "spotlight",
  "upcoming",
  "continueYourDay",
  "countryLinqa",
  "breakingAroundWorld"
] as const;

export type HideableHomeSection = (typeof HIDEABLE_HOME_SECTIONS)[number];

export type HomeNewsItem = {
  title: string;
  summary?: string;
  canonicalUrl: string;
  imageUrl?: string | null;
  publisherDomain: string;
  publisherName: string;
  publishedAt: string;
  category: string;
  countryCode?: string | null;
  providerName: string;
  publisherTrustStatus: PublisherTrustStatus;
  attributionRequired: boolean;
  breakingEligible: boolean;
};

export type HomeLiveUpdate = {
  id: string;
  title: string;
  summary: string | null;
  canonicalUrl: string;
  imageUrl: string | null;
  publisherName: string;
  publisherDomain: string;
  category: string;
  countryCode: string | null;
  publishedAt: string;
  breaking: boolean;
  attributionRequired: boolean;
};

export type HomeProfile = {
  userId: string;
  displayName: string;
  bio: string | null;
  countryCode: string | null;
  countryName: string | null;
  countryVerificationState: string;
  statusBody: string | null;
  activeDevices: number;
};

export type HomeNotifications = {
  unreadMessages: number;
  unreadConversations: number;
  pendingMessageRequests: number;
  unacknowledgedSecurityAlerts: number;
  pendingCountryLinqaNotifications: number;
  /** Incoming calls missed inside the server's rolling window. */
  missedCalls: number;
  total: number;
};

export type HomeCountryLinqaPanel = {
  countryCode: string | null;
  countryName: string | null;
  regionCode: string | null;
  verificationState: string;
  trends: Array<{ rank: number; category: string; storyCount: number }>;
  publishedEvents: number;
  communityMembers: number;
};

export type HomeUpcomingEvent = {
  id: string;
  title: string;
  startsAt: string;
  countryCode: string | null;
  regionCode: string | null;
  city: string | null;
};

export type HomeContinueItem = {
  conversationId: string;
  title: string;
  isGroup: boolean;
  preview: string | null;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  lastMessageAt: string | null;
};

/**
 * A Vault entry as Home can honestly describe it.
 *
 * There is no `name`: filenames are encrypted with a key the server never
 * holds, so the card is labelled from the item type and its recency instead of
 * from a name nobody on the server side can read.
 */
export type HomeVaultItem = {
  id: string;
  itemType: "DOCUMENT" | "IDENTITY" | "PHOTO" | "RECOVERY" | "OTHER";
  sizeBytes: number;
  version: number;
  updatedAt: string;
};

export type HomePendingTransfer = {
  id: string;
  publicId: string;
  recipientName: string;
  status: string;
  sendAmountMinor: string;
  sendCurrency: string;
  /** True when the user is the blocker, so the card can offer to resume it. */
  resumable: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Counts behind the tab-bar badges. */
export type HomeBadges = { chats: number; calls: number; notifications: number };

export type HomeQuickAction = { key?: string; label?: string; route?: string };

export type HomeFeedPayload = {
  generatedAt: string;
  jurisdictionCountry: string;
  profile: HomeProfile | null;
  notifications: HomeNotifications | null;
  quickActions: HomeQuickAction[];
  liveUpdates: HomeLiveUpdate[];
  spotlight?: HomeLiveUpdate | null;
  upcoming: HomeUpcomingEvent[];
  continueYourDay: HomeContinueItem[];
  vaultRecent: HomeVaultItem[];
  pendingTransfers: HomePendingTransfer[];
  countryLinqa: HomeCountryLinqaPanel | null;
  breakingAroundWorld: HomeNewsItem[];
  serviceState: {
    news: HomeNewsState;
    personalized: boolean;
    hiddenSections: string[];
    degraded: string[];
  };
};

export type HomePreferences = {
  hiddenSections: HideableHomeSection[];
  preferredCategories: string[];
  followedCountries: string[];
  followedTopics: string[];
  quickActions: HomeQuickAction[];
  personalizationEnabled: boolean;
};

export type HomeNewsPage = {
  articles: HomeLiveUpdate[];
  total: number;
  limit: number;
  offset: number;
  attributionRequired: boolean;
};

/** Raised when the user has no server-verified jurisdiction yet. */
export class JurisdictionRequiredError extends Error {
  constructor() {
    super("Confirm your country to finish setting up Home.");
    this.name = "JurisdictionRequiredError";
  }
}

export class HomeFeedService {
  constructor(
    private readonly baseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...(init.headers ?? {})
      }
    });

    const text = await response.text();
    const data: unknown = text ? JSON.parse(text) : {};

    if (response.status === 409 && (data as { code?: string }).code === "HOME_JURISDICTION_REQUIRED") {
      throw new JurisdictionRequiredError();
    }
    if (!response.ok) {
      const body = data as { code?: string; error?: string };
      throw new Error(body.code ?? body.error ?? `Home request failed (${response.status}).`);
    }
    return data as T;
  }

  loadFeed(): Promise<HomeFeedPayload> {
    return this.request<HomeFeedPayload>("/v1/mobile/home");
  }

  /**
   * Badge counts only. The tab bar is mounted on every screen, so it must not
   * pay for the full Home build to know whether to draw a dot.
   */
  loadBadges(): Promise<HomeBadges> {
    return this.request<HomeBadges>("/v1/mobile/home/badges");
  }

  loadPreferences(): Promise<{
    preferences: HomePreferences;
    hideableSections: HideableHomeSection[];
    categories: string[];
  }> {
    return this.request("/v1/mobile/home/preferences");
  }

  savePreferences(patch: Partial<HomePreferences>): Promise<{ preferences: HomePreferences }> {
    return this.request("/v1/mobile/home/preferences", {
      method: "PUT",
      body: JSON.stringify(patch)
    });
  }

  loadNews(options: {
    category?: string;
    country?: string;
    breakingOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<HomeNewsPage> {
    const query = new URLSearchParams();
    if (options.category) query.set("category", options.category.toUpperCase());
    if (options.country) query.set("country", options.country.toUpperCase());
    if (options.breakingOnly) query.set("breakingOnly", "true");
    query.set("limit", String(options.limit ?? 20));
    query.set("offset", String(options.offset ?? 0));
    return this.request<HomeNewsPage>(`/v1/mobile/home/news?${query.toString()}`);
  }
}

/**
 * Human-readable explanation of the news service state. Used verbatim in the
 * UI so a degraded Home never looks like an empty Home.
 */
export function newsStateLabel(state: HomeNewsState | undefined): { label: string; detail: string } {
  switch (state) {
    case "LIVE":
      return { label: "LIVE", detail: "Updated from verified publishers." };
    case "STALE":
      return {
        label: "STALE",
        detail: "Showing the last verified stories — the news service is reconnecting."
      };
    case "UNAVAILABLE":
      return {
        label: "UNAVAILABLE",
        detail: "No verified publisher story is available right now."
      };
    default:
      return { label: "SYNC", detail: "Checking the news service." };
  }
}

/** Attribution line a publisher's licence requires Home to render. */
export function attributionFor(item: {
  publisherName: string;
  publisherDomain: string;
  countryCode?: string | null;
  publishedAt: string;
}): string {
  const publisher = item.publisherName || item.publisherDomain;
  const parts = [publisher];
  if (item.countryCode) parts.push(item.countryCode.toUpperCase());
  parts.push(relativeAge(item.publishedAt));
  return parts.filter(Boolean).join(" · ");
}

export function relativeAge(value: string | null | undefined): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "";
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString();
}
