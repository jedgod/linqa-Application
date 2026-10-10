import type { Database } from "../db/pool.js";
import { authorizeNewDirectChat, liveChatAccessDeps } from "../services/countrylinqa/chat-access.js";
import { ChatError } from "./chat.service.js";

export function normalizeChatPhone(value: string): string {
  const phone = value.trim().replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new ChatError(422, "INVALID_PHONE_NUMBER");
  return phone;
}

/** Exact verified-number lookup; never a prefix search or a public account directory. */
export async function findChatContact(db: Database, callerId: string, value: string): Promise<{ id: string; displayName: string } | null> {
  const phone = normalizeChatPhone(value);
  const result = await db.query(
    `SELECT u.id, COALESCE(NULLIF(p.stage_name,''),p.display_name,'Linqa User') AS "displayName"
       FROM account_identifiers ai JOIN users u ON u.id=ai.user_id
       LEFT JOIN user_profiles p ON p.user_id=u.id
       WHERE ai.type='PHONE' AND ai.normalized_value=$1 AND ai.verified_at IS NOT NULL
         AND ai.disabled_at IS NULL AND u.status='ACTIVE' AND u.id<>$2
         AND NOT EXISTS (SELECT 1 FROM contact_discovery_identifiers d
           WHERE d.user_id=u.id AND d.identifier_type='PHONE' AND d.discoverable=FALSE)
       LIMIT 1`, [phone, callerId]);
  const contact = result.rows[0] as { id: string; displayName: string } | undefined;
  if (!contact) return null;
  const decision = await authorizeNewDirectChat(callerId, contact.id, liveChatAccessDeps(db));
  return decision.allowed ? contact : null;
}
