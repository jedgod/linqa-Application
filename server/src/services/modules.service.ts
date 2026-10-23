import type { Database } from "../db/pool.js";

/** Roles that may read an organization's audit log. */
export const AUDIT_ROLES = ["OWNER", "ADMIN", "SECURITY_ADMIN", "COMPLIANCE_ADMIN"] as const;

export type NoteRecord = { id: string; noteType: "NOTE" | "CHECKLIST" | "DRAWING" | "VOICE"; ciphertextBase64: string; createdAt: string; updatedAt: string };
export type EventRecord = { id: string; startsAt: string; endsAt: string; titleCiphertextBase64: string; descriptionCiphertextBase64: string | null; createdAt: string };

const iso = (value: Date | string) => new Date(value).toISOString();
const b64 = (value: Buffer | null) => (value ? value.toString("base64") : null);

function note(row: any): NoteRecord {
  return { id: row.id, noteType: row.note_type, ciphertextBase64: b64(row.ciphertext)!, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
function event(row: any): EventRecord {
  return {
    id: row.id, startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), createdAt: iso(row.created_at),
    titleCiphertextBase64: b64(row.title_ciphertext)!, descriptionCiphertextBase64: b64(row.description_ciphertext)
  };
}

/**
 * Notes and calendar events are end-to-end encrypted: the phone seals the content and the server stores and returns only
 * ciphertext (plus an event's start and end time, which scheduling needs). Everything here is scoped to the signed-in owner.
 * Sharing a note or inviting attendees would need a way to hand the content key to another person, so it is not offered.
 *
 * Enterprise reads are read-only views over the organization, membership, policy and audit tables. Roles and policies are
 * provisioned by the trusted admin system, never by a mobile client.
 */
export class ModulesService {
  constructor(private readonly db: Database) {}

  async listNotes(userId: string): Promise<NoteRecord[]> {
    const r = await this.db.query(
      `SELECT id,note_type,ciphertext,created_at,updated_at FROM secure_notes_v2 WHERE owner_user_id=$1 ORDER BY updated_at DESC LIMIT 200`, [userId]);
    return r.rows.map(note);
  }

  async replaceNote(userId: string, id: string, ciphertext: Buffer): Promise<NoteRecord | null> {
    const r = await this.db.query(
      `UPDATE secure_notes_v2 SET ciphertext=$3,updated_at=now() WHERE id=$1 AND owner_user_id=$2 RETURNING id,note_type,ciphertext,created_at,updated_at`,
      [id, userId, ciphertext]);
    return r.rows[0] ? note(r.rows[0]) : null;
  }

  async deleteNote(userId: string, id: string): Promise<boolean> {
    return (await this.db.query(`DELETE FROM secure_notes_v2 WHERE id=$1 AND owner_user_id=$2`, [id, userId])).rowCount === 1;
  }

  async listEvents(userId: string, range: { from?: Date; to?: Date }): Promise<EventRecord[]> {
    const r = await this.db.query(
      `SELECT id,starts_at,ends_at,title_ciphertext,description_ciphertext,created_at FROM calendar_events_v2
        WHERE owner_user_id=$1 AND ($2::timestamptz IS NULL OR starts_at>=$2) AND ($3::timestamptz IS NULL OR starts_at<$3)
        ORDER BY starts_at LIMIT 300`, [userId, range.from ?? null, range.to ?? null]);
    return r.rows.map(event);
  }

  async updateEvent(userId: string, id: string, patch: { titleCiphertext?: Buffer; descriptionCiphertext?: Buffer; startsAt?: Date; endsAt?: Date }): Promise<EventRecord | null> {
    try {
      const r = await this.db.query(
        `UPDATE calendar_events_v2 SET title_ciphertext=COALESCE($3,title_ciphertext), description_ciphertext=COALESCE($4,description_ciphertext),
                starts_at=COALESCE($5,starts_at), ends_at=COALESCE($6,ends_at)
          WHERE id=$1 AND owner_user_id=$2 RETURNING id,starts_at,ends_at,title_ciphertext,description_ciphertext,created_at`,
        [id, userId, patch.titleCiphertext ?? null, patch.descriptionCiphertext ?? null, patch.startsAt ?? null, patch.endsAt ?? null]);
      return r.rows[0] ? event(r.rows[0]) : null;
    } catch (error) {
      if ((error as { code?: string }).code === "23514") throw new Error("INVALID_EVENT_TIME"); // ends_at must be after starts_at
      throw error;
    }
  }

  async deleteEvent(userId: string, id: string): Promise<boolean> {
    return (await this.db.query(`DELETE FROM calendar_events_v2 WHERE id=$1 AND owner_user_id=$2`, [id, userId])).rowCount === 1;
  }

  /** The caller's active role in the organization, or an ORGANIZATION_NOT_FOUND error (never reveals whether it exists). */
  private async roleIn(orgId: string, userId: string): Promise<string> {
    const r = await this.db.query(`SELECT role FROM organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='ACTIVE'`, [orgId, userId]);
    if (!r.rows[0]) throw new Error("ORGANIZATION_NOT_FOUND");
    return r.rows[0].role;
  }

  async organizations(userId: string) {
    const r = await this.db.query(
      `SELECT o.id,o.name,o.slug,o.status,m.role FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id
        WHERE m.user_id=$1 AND m.status='ACTIVE' ORDER BY o.name LIMIT 100`, [userId]);
    return r.rows.map((o) => ({ id: o.id, name: o.name, slug: o.slug, status: o.status, role: o.role }));
  }

  async organization(orgId: string, userId: string) {
    const role = await this.roleIn(orgId, userId);
    const r = await this.db.query(
      `SELECT o.id,o.name,o.slug,o.status,o.created_at,
              (SELECT count(*) FROM organization_memberships WHERE organization_id=o.id AND status='ACTIVE') AS members,
              (SELECT count(*) FROM enterprise_policies WHERE organization_id=o.id AND enforced) AS policies
         FROM organizations o WHERE o.id=$1`, [orgId]);
    const o = r.rows[0];
    return { id: o.id, name: o.name, slug: o.slug, status: o.status, role, createdAt: iso(o.created_at), memberCount: Number(o.members), enforcedPolicyCount: Number(o.policies) };
  }

  async directory(orgId: string, userId: string) {
    await this.roleIn(orgId, userId);
    const r = await this.db.query(
      `SELECT m.user_id,m.role,p.display_name FROM organization_memberships m LEFT JOIN user_profiles p ON p.user_id=m.user_id
        WHERE m.organization_id=$1 AND m.status='ACTIVE' ORDER BY lower(p.display_name) NULLS LAST,m.user_id LIMIT 500`, [orgId]);
    return r.rows.map((m) => ({ userId: m.user_id, displayName: m.display_name ?? null, role: m.role }));
  }

  async policies(orgId: string, userId: string) {
    await this.roleIn(orgId, userId);
    const r = await this.db.query(`SELECT id,policy_key,policy_value,enforced,updated_at FROM enterprise_policies WHERE organization_id=$1 ORDER BY policy_key`, [orgId]);
    return r.rows.map((p) => ({ id: p.id, key: p.policy_key, value: p.policy_value, enforced: p.enforced, updatedAt: iso(p.updated_at) }));
  }

  async auditLog(orgId: string, userId: string) {
    const role = await this.roleIn(orgId, userId);
    if (!(AUDIT_ROLES as readonly string[]).includes(role)) throw new Error("ADMIN_REQUIRED");
    const r = await this.db.query(
      `SELECT id,actor_user_id,event_type,target_type,target_id,created_at FROM organization_audit_events WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 200`, [orgId]);
    return r.rows.map((e) => ({ id: e.id, actorUserId: e.actor_user_id, eventType: e.event_type, targetType: e.target_type, targetId: e.target_id, createdAt: iso(e.created_at) }));
  }
}
