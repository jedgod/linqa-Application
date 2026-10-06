import type { PoolClient } from "pg";

export type ChatReachMode = "MY_COUNTRY" | "SELECTED_COUNTRIES" | "REGION" | "WORLDWIDE" | "EXISTING_CONTACTS_ONLY" | "NOBODY";
export const CHAT_REACH_MODES: ChatReachMode[] = ["MY_COUNTRY", "SELECTED_COUNTRIES", "REGION", "WORLDWIDE", "EXISTING_CONTACTS_ONLY", "NOBODY"];
export type Decision = { allowed: true; reason: string } | { allowed: false; code: string; reason: string };

export interface ChatPolicy { mode: ChatReachMode; countryCodes: string[]; regionCode: string | null; existingContactsBypass: boolean }

export interface Deps {
  getVerifiedCountry(id: string): Promise<string | null>;
  getChatPolicy(id: string): Promise<ChatPolicy>;
  isBlockedEitherDirection(a: string, b: string): Promise<boolean>;
  isRestricted(id: string): Promise<boolean>;
  hasExistingDirectConversation(a: string, b: string): Promise<boolean>;
  isExistingContact(a: string, b: string): Promise<boolean>;
  countryInRegion(country: string, region: string): Promise<boolean>;
}

const n = (x: string) => x.trim().toUpperCase();

/**
 * Who may START a new direct chat with whom (CountryLinqa chat access control).
 *
 * It decides only whether a NEW conversation may begin. An existing conversation is never touched
 * by a change of reach, and blocks and restrictions always win over every reach setting. This is
 * the one function every creation path must call, so a client cannot dodge it by using a different
 * route (there is one creation boundary today: `resolveDirectConversation`).
 *
 * Differences from the pack: WORLDWIDE needs no verified countries (no geography is involved);
 * region membership is a database lookup, so `countryInRegion` is async.
 */
export async function authorizeNewDirectChat(sender: string, recipient: string, d: Deps): Promise<Decision> {
  if (sender === recipient) return { allowed: false, code: "INVALID_RECIPIENT", reason: "Cannot chat with self." };
  if (await d.isBlockedEitherDirection(sender, recipient)) return { allowed: false, code: "BLOCKED", reason: "Direct chat unavailable." };
  if ((await d.isRestricted(sender)) || (await d.isRestricted(recipient))) return { allowed: false, code: "RESTRICTED_USER", reason: "Direct chat unavailable." };

  // Country reach changes never destroy an already-established conversation.
  if (await d.hasExistingDirectConversation(sender, recipient)) return { allowed: true, reason: "EXISTING_CONVERSATION" };

  const p = await d.getChatPolicy(recipient);
  if (p.existingContactsBypass && (await d.isExistingContact(sender, recipient))) return { allowed: true, reason: "EXISTING_CONTACT" };
  if (p.mode === "NOBODY") return { allowed: false, code: "CHAT_REQUESTS_DISABLED", reason: "Recipient is not accepting new chats." };
  if (p.mode === "EXISTING_CONTACTS_ONLY") return { allowed: false, code: "CONTACTS_ONLY", reason: "Recipient accepts existing contacts only." };
  if (p.mode === "WORLDWIDE") return { allowed: true, reason: "COUNTRY_ALLOWED" };

  const sc = await d.getVerifiedCountry(sender);
  const rc = await d.getVerifiedCountry(recipient);
  if (!sc || !rc) return { allowed: false, code: "COUNTRY_UNVERIFIED", reason: "Verified country required." };
  if (p.mode === "MY_COUNTRY") return n(sc) === n(rc) ? { allowed: true, reason: "COUNTRY_ALLOWED" } : { allowed: false, code: "COUNTRY_NOT_ALLOWED", reason: "Recipient accepts new chats from their country only." };
  if (p.mode === "SELECTED_COUNTRIES") return p.countryCodes.map(n).includes(n(sc)) ? { allowed: true, reason: "COUNTRY_ALLOWED" } : { allowed: false, code: "COUNTRY_NOT_ALLOWED", reason: "Your country is outside recipient chat reach." };
  if (p.mode === "REGION" && p.regionCode) return (await d.countryInRegion(n(sc), p.regionCode)) ? { allowed: true, reason: "COUNTRY_ALLOWED" } : { allowed: false, code: "COUNTRY_NOT_ALLOWED", reason: "Your country is outside recipient chat region." };
  return { allowed: false, code: "CHAT_REQUESTS_DISABLED", reason: "New chat unavailable." };
}

/** The live bindings: the platform block list, contacts, users and country tables. */
export function liveChatAccessDeps(client: Pick<PoolClient, "query">): Deps {
  return {
    async getVerifiedCountry(id) {
      const { rows } = await client.query("SELECT verified_country_code AS c FROM users WHERE id = $1 AND country_verification_state = 'VERIFIED'", [id]);
      return (rows[0]?.c as string | null | undefined)?.trim() || null;
    },
    async getChatPolicy(id) {
      const { rows } = await client.query(
        `SELECT p.chat_reach_mode AS mode, p.chat_region_code AS region, p.existing_contacts_bypass_chat_reach AS bypass,
                COALESCE((SELECT json_agg(cl.country_code) FROM country_chat_links cl WHERE cl.user_id = $1), '[]'::json) AS countries
           FROM users u LEFT JOIN country_discovery_preferences p ON p.user_id = u.id WHERE u.id = $1`,
        [id]
      );
      const r = rows[0];
      return {
        mode: (r?.mode as ChatReachMode | null | undefined) ?? "MY_COUNTRY",
        countryCodes: ((r?.countries as string[] | undefined) ?? []).map((c) => c.trim()),
        regionCode: (r?.region as string | null | undefined) ?? null,
        existingContactsBypass: (r?.bypass as boolean | null | undefined) ?? true
      };
    },
    async isBlockedEitherDirection(a, b) {
      const { rowCount } = await client.query("SELECT 1 FROM blocked_users WHERE (blocker_user_id = $1 AND blocked_user_id = $2) OR (blocker_user_id = $2 AND blocked_user_id = $1)", [a, b]);
      return (rowCount ?? 0) > 0;
    },
    async isRestricted(id) {
      const { rows } = await client.query("SELECT status FROM users WHERE id = $1", [id]);
      return !rows[0] || rows[0].status !== "ACTIVE";
    },
    async hasExistingDirectConversation(a, b) {
      const { rowCount } = await client.query("SELECT 1 FROM direct_conversation_keys WHERE user_low = LEAST($1::uuid,$2::uuid) AND user_high = GREATEST($1::uuid,$2::uuid)", [a, b]);
      return (rowCount ?? 0) > 0;
    },
    // Either person having added the other (QR, search, invite) counts: a contact appears in the
    // sender's list only when the recipient shared a code, and the other way round is the
    // recipient's own choice.
    async isExistingContact(a, b) {
      const { rowCount } = await client.query("SELECT 1 FROM chat_contacts WHERE (owner_user_id = $1 AND contact_user_id = $2) OR (owner_user_id = $2 AND contact_user_id = $1)", [a, b]);
      return (rowCount ?? 0) > 0;
    },
    // A country is in a region when its own region, or any region above it, is the one chosen.
    async countryInRegion(country, region) {
      const { rowCount } = await client.query(
        `WITH RECURSIVE up(code, parent_code, depth) AS (
           SELECT g.code, g.parent_code, 0 FROM geographic_regions g JOIN countries c ON c.region_code = g.code WHERE c.code = $1
           UNION ALL
           SELECT g.code, g.parent_code, up.depth + 1 FROM geographic_regions g JOIN up ON g.code = up.parent_code WHERE up.depth < 10
         ) SELECT 1 FROM up WHERE code = $2`,
        [country, region]
      );
      return (rowCount ?? 0) > 0;
    }
  };
}

/**
 * Which chat reaches a plan may choose. Opening chat to chosen countries, a region or the world
 * follows the same plan rules as inbound discovery; narrowing it (contacts only, nobody) is free.
 */
export function chatReachEntitlements(tier: "FREE" | "PREMIUM" | "ELITE"): Record<ChatReachMode, boolean> {
  const paid = tier === "PREMIUM" || tier === "ELITE";
  return { MY_COUNTRY: true, SELECTED_COUNTRIES: paid, REGION: paid, WORLDWIDE: tier === "ELITE", EXISTING_CONTACTS_ONLY: true, NOBODY: true };
}
