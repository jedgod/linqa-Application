import type { Database } from "../db/pool.js";

export interface PrivacySettings {
  profileVisibility: "EVERYONE" | "CONTACTS" | "NOBODY";
  phoneDiscoverability: boolean;
  emailDiscoverability: boolean;
  usernameDiscoverability: boolean;
  readReceipts: boolean;
  typingIndicators: boolean;
  lastSeenVisibility: "EVERYONE" | "CONTACTS" | "NOBODY";
}

/**
 * Not part of the supplied pack (only the `privacy_settings` migration and
 * the web `PrivacySettingsClient` were given, no server-side service). Added
 * so `PUT /v1/privacy/settings` is reachable — matches the pack's own
 * repository/service-per-table convention.
 */
export class PrivacySettingsService {
  constructor(private readonly db: Database) {}

  async update(userId: string, settings: PrivacySettings): Promise<void> {
    await this.db.query(
      `INSERT INTO privacy_settings (
         user_id, profile_visibility, phone_discoverability,
         email_discoverability, username_discoverability,
         read_receipts, typing_indicators, last_seen_visibility
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id)
       DO UPDATE SET
         profile_visibility = EXCLUDED.profile_visibility,
         phone_discoverability = EXCLUDED.phone_discoverability,
         email_discoverability = EXCLUDED.email_discoverability,
         username_discoverability = EXCLUDED.username_discoverability,
         read_receipts = EXCLUDED.read_receipts,
         typing_indicators = EXCLUDED.typing_indicators,
         last_seen_visibility = EXCLUDED.last_seen_visibility,
         updated_at = now()`,
      [
        userId,
        settings.profileVisibility,
        settings.phoneDiscoverability,
        settings.emailDiscoverability,
        settings.usernameDiscoverability,
        settings.readReceipts,
        settings.typingIndicators,
        settings.lastSeenVisibility
      ]
    );
  }
}
