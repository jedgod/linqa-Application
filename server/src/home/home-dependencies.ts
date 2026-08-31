import type { Database } from "../db/pool.js";
import { homeProductionConfig } from "../config/home-production.config.js";
import { discoverEvents } from "../services/countrylinqa/golive/eventRanking.js";
import { HomeRepository, type StoredNewsRow } from "./home.repository.js";
import type { HomeFeedDependencies } from "./home-feed.service.js";

/**
 * Real data sources for every Home section.
 *
 * v1.1 left these as an integration seam (`getProfile`, `getSpotlight`, ...).
 * This is that seam filled in against tables that already exist in this repo,
 * so Home renders the user's actual profile, unread counts, conversations,
 * CountryLinqa jurisdiction and events — not a shape-compatible placeholder.
 */

export interface HomeProfile {
  userId: string;
  displayName: string;
  bio: string | null;
  countryCode: string | null;
  countryName: string | null;
  countryVerificationState: string;
  statusBody: string | null;
  activeDevices: number;
}

export interface HomeNotifications {
  unreadMessages: number;
  unreadConversations: number;
  pendingMessageRequests: number;
  unacknowledgedSecurityAlerts: number;
  pendingCountryLinqaNotifications: number;
  total: number;
}

export interface HomeContinueItem {
  conversationId: string;
  title: string;
  isGroup: boolean;
  preview: string | null;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  lastMessageAt: string | null;
}

export interface HomeCountryLinqaPanel {
  countryCode: string | null;
  countryName: string | null;
  regionCode: string | null;
  verificationState: string;
  trends: Array<{ rank: number; category: string; storyCount: number }>;
  publishedEvents: number;
}

export interface HomeLiveUpdate {
  id: string;
  title: string;
  canonicalUrl: string;
  imageUrl: string | null;
  publisherName: string;
  publisherDomain: string;
  category: string;
  countryCode: string | null;
  publishedAt: string;
  breaking: boolean;
  attributionRequired: boolean;
}

function toLiveUpdate(row: StoredNewsRow): HomeLiveUpdate {
  return {
    id: row.id,
    title: row.title,
    canonicalUrl: row.canonicalUrl,
    imageUrl: row.imageUrl,
    publisherName: row.publisherName,
    publisherDomain: row.publisherDomain,
    category: row.category,
    countryCode: row.countryCode,
    publishedAt: new Date(row.publishedAt).toISOString(),
    breaking: row.breaking,
    attributionRequired: row.attributionRequired
  };
}

/**
 * Server-authoritative jurisdiction. The client never gets to assert its own
 * country: `users.verified_country_code` is set by the CountryLinqa
 * verification flow, and Home refuses to render without it (409) rather than
 * guessing a default.
 */
export async function resolveJurisdictionCountry(db: Database, userId: string): Promise<string | null> {
  const result = await db.query(
    `SELECT verified_country_code FROM users WHERE id=$1 AND status='ACTIVE'`,
    [userId]
  );
  const code = (result.rows[0] as { verified_country_code: string | null } | undefined)?.verified_country_code;
  return code ? code.trim().toUpperCase() : null;
}

export function createHomeDependencies(db: Database, repository: HomeRepository): HomeFeedDependencies {
  return {
    async getProfile(userId: string): Promise<HomeProfile> {
      const result = await db.query(
        `SELECT u.id AS "userId",
                COALESCE(p.display_name,'Linqa User') AS "displayName",
                p.bio,
                u.verified_country_code AS "countryCode",
                c.name AS "countryName",
                u.country_verification_state::text AS "countryVerificationState",
                s.body AS "statusBody",
                (SELECT count(*)::int FROM devices d
                   WHERE d.user_id=u.id AND d.status='ACTIVE') AS "activeDevices"
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id=u.id
         LEFT JOIN countries c ON c.code=u.verified_country_code
         LEFT JOIN LATERAL (
           SELECT body FROM user_status_updates
           WHERE user_id=u.id AND expires_at>now()
           ORDER BY created_at DESC LIMIT 1
         ) s ON TRUE
         WHERE u.id=$1`,
        [userId]
      );
      const row = result.rows[0] as HomeProfile | undefined;
      if (!row) throw new Error("HOME_PROFILE_NOT_FOUND");
      return row;
    },

    async getNotifications(userId: string): Promise<HomeNotifications> {
      // One round trip: Home is latency-sensitive and these are four trivial
      // counts against indexed columns.
      const result = await db.query(
        `SELECT
           COALESCE((SELECT sum(cm.unread_count)::int FROM conversation_members cm
             JOIN conversations c ON c.id=cm.conversation_id
             WHERE cm.user_id=$1 AND cm.removed_at IS NULL AND c.archived_at IS NULL), 0) AS "unreadMessages",
           COALESCE((SELECT count(*)::int FROM conversation_members cm
             JOIN conversations c ON c.id=cm.conversation_id
             WHERE cm.user_id=$1 AND cm.removed_at IS NULL AND c.archived_at IS NULL
               AND cm.unread_count > 0), 0) AS "unreadConversations",
           COALESCE((SELECT count(*)::int FROM message_requests
             WHERE recipient_user_id=$1 AND status='PENDING'), 0) AS "pendingMessageRequests",
           COALESCE((SELECT count(*)::int FROM device_security_alerts
             WHERE user_id=$1 AND acknowledged_at IS NULL), 0) AS "unacknowledgedSecurityAlerts",
           COALESCE((SELECT count(*)::int FROM countrylinqa_notification_outbox
             WHERE user_id=$1 AND status='PENDING'), 0) AS "pendingCountryLinqaNotifications"`,
        [userId]
      );
      const row = (result.rows[0] ?? {}) as Omit<HomeNotifications, "total">;
      return {
        unreadMessages: Number(row.unreadMessages ?? 0),
        unreadConversations: Number(row.unreadConversations ?? 0),
        pendingMessageRequests: Number(row.pendingMessageRequests ?? 0),
        unacknowledgedSecurityAlerts: Number(row.unacknowledgedSecurityAlerts ?? 0),
        pendingCountryLinqaNotifications: Number(row.pendingCountryLinqaNotifications ?? 0),
        total:
          Number(row.unreadMessages ?? 0) +
          Number(row.pendingMessageRequests ?? 0) +
          Number(row.unacknowledgedSecurityAlerts ?? 0)
      };
    },

    async getCountryLinqa(userId: string, country: string): Promise<HomeCountryLinqaPanel> {
      const [identity, trends, events] = await Promise.all([
        db.query(
          `SELECT u.verified_country_code AS "countryCode",
                  c.name AS "countryName",
                  c.region_code AS "regionCode",
                  u.country_verification_state::text AS "verificationState"
           FROM users u LEFT JOIN countries c ON c.code=u.verified_country_code
           WHERE u.id=$1`,
          [userId]
        ),
        repository.categoryTrends(24, 3),
        db.query(
          `SELECT count(*)::int AS total FROM events
           WHERE status='PUBLISHED' AND starts_at>now() AND country_code=$1`,
          [country]
        )
      ]);

      const row = (identity.rows[0] ?? {}) as {
        countryCode?: string | null;
        countryName?: string | null;
        regionCode?: string | null;
        verificationState?: string;
      };

      return {
        countryCode: row.countryCode ?? country,
        countryName: row.countryName ?? null,
        regionCode: row.regionCode ?? null,
        verificationState: row.verificationState ?? "UNVERIFIED",
        trends: trends.map((trend, index) => ({
          rank: index + 1,
          category: trend.category,
          storyCount: trend.storyCount
        })),
        publishedEvents: Number((events.rows[0] as { total?: number } | undefined)?.total ?? 0)
      };
    },

    getUpcoming(userId: string): Promise<unknown[]> {
      return discoverEvents(db, userId, homeProductionConfig.feed.maxUpcomingItems);
    },

    async getContinueYourDay(userId: string): Promise<HomeContinueItem[]> {
      const result = await db.query(
        `SELECT c.id AS "conversationId",
                COALESCE(c.display_title,'Conversation') AS title,
                (c.conversation_type <> 'DIRECT') AS "isGroup",
                c.last_message_preview AS preview,
                cm.unread_count AS "unreadCount",
                cm.pinned,
                cm.muted,
                c.last_message_at AS "lastMessageAt"
         FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$1 AND cm.removed_at IS NULL
         WHERE c.archived_at IS NULL
         ORDER BY cm.pinned DESC, cm.unread_count DESC, c.last_message_at DESC NULLS LAST
         LIMIT $2`,
        [userId, homeProductionConfig.feed.maxContinueItems]
      );
      return (result.rows as HomeContinueItem[]).map((row) => ({
        ...row,
        unreadCount: Number(row.unreadCount ?? 0),
        lastMessageAt: row.lastMessageAt ? new Date(row.lastMessageAt).toISOString() : null
      }));
    },

    async getLiveUpdates(_userId: string, country: string): Promise<HomeLiveUpdate[]> {
      const limit = homeProductionConfig.feed.maxLiveUpdateItems;
      // Prefer the user's own jurisdiction, then top up from world coverage so
      // the rail is never half-empty in a country with little local output.
      const local = await repository.listArticles({ countryCode: country, sinceHours: 12, limit });
      if (local.length >= limit) return local.map(toLiveUpdate);

      const world = await repository.listArticles({ sinceHours: 12, limit: limit * 2 });
      const combined = [...local];
      for (const row of world) {
        if (combined.length >= limit) break;
        if (!combined.some((existing) => existing.id === row.id)) combined.push(row);
      }
      return combined.map(toLiveUpdate);
    },

    async getSpotlight(_userId: string, country: string): Promise<HomeLiveUpdate | null> {
      // Spotlight is an image-led card, so an article without an image is not
      // a candidate; local first, then world.
      const local = await repository.listArticles({
        countryCode: country,
        withImageOnly: true,
        sinceHours: 24,
        limit: 1
      });
      const chosen = local[0]
        ?? (await repository.listArticles({ withImageOnly: true, sinceHours: 24, limit: 1 }))[0];
      return chosen ? toLiveUpdate(chosen) : null;
    }
  };
}
