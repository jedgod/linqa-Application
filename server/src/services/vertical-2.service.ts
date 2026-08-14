import type { Database } from "../db/pool.js";

export class Vertical2Service {
  constructor(private readonly db: Database) {}

  async inviteContact(senderUserId: string, recipientUserId: string) {
    const result = await this.db.query(
      `INSERT INTO contact_invites_v2(sender_user_id,recipient_user_id)
       VALUES($1,$2)
       ON CONFLICT (sender_user_id,recipient_user_id) WHERE status='PENDING'
       DO UPDATE SET created_at=contact_invites_v2.created_at
       RETURNING id,status,created_at`,
      [senderUserId, recipientUserId]
    );
    return result.rows[0];
  }

  async resolveContactInvite(recipientUserId: string, inviteId: string, action: "ACCEPT" | "DECLINE" | "BLOCK") {
    const result = await this.db.query(
      `UPDATE contact_invites_v2 SET status=$3,resolved_at=now()
       WHERE id=$1 AND recipient_user_id=$2 AND status='PENDING'
       RETURNING id`,
      [inviteId, recipientUserId, action === "ACCEPT" ? "ACCEPTED" : action === "DECLINE" ? "DECLINED" : "BLOCKED"]
    );
    if (result.rowCount !== 1) throw new Error("contact_invite_not_found");
  }

  async createCalendarEvent(input: {
    ownerUserId: string;
    titleCiphertext: Buffer;
    descriptionCiphertext?: Buffer;
    startsAt: Date;
    endsAt: Date;
    attendeeUserIds: string[];
  }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const event = await client.query(
        `INSERT INTO calendar_events_v2(owner_user_id,title_ciphertext,description_ciphertext,starts_at,ends_at)
         VALUES($1,$2,$3,$4,$5) RETURNING id,starts_at,ends_at,created_at`,
        [input.ownerUserId, input.titleCiphertext, input.descriptionCiphertext ?? null, input.startsAt, input.endsAt]
      );
      for (const userId of new Set(input.attendeeUserIds)) {
        await client.query(
          `INSERT INTO calendar_event_attendees_v2(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
          [event.rows[0].id, userId]
        );
      }
      await client.query("COMMIT");
      return event.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createNote(input: {
    ownerUserId: string;
    noteType: "NOTE" | "CHECKLIST" | "DRAWING" | "VOICE";
    ciphertext: Buffer;
    collaborators: Array<{ userId: string; permission: "VIEW" | "EDIT" }>;
  }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const note = await client.query(
        `INSERT INTO secure_notes_v2(owner_user_id,note_type,ciphertext)
         VALUES($1,$2,$3) RETURNING id,note_type,created_at,updated_at`,
        [input.ownerUserId, input.noteType, input.ciphertext]
      );
      for (const collaborator of input.collaborators) {
        await client.query(
          `INSERT INTO collaborative_note_members_v2(note_id,user_id,permission)
           VALUES($1,$2,$3) ON CONFLICT(note_id,user_id) DO UPDATE SET permission=EXCLUDED.permission`,
          [note.rows[0].id, collaborator.userId, collaborator.permission]
        );
      }
      await client.query("COMMIT");
      return note.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async requestScreenShare(input: { callId: string; userId: string; deviceId: string; shareType: string }) {
    const participant = await this.db.query(
      `SELECT 1 FROM call_sessions WHERE id=$1 AND (caller_user_id=$2 OR callee_user_id=$2) AND state='ACTIVE'`,
      [input.callId, input.userId]
    );
    if (participant.rowCount !== 1) throw new Error("active_call_participant_required");
    const result = await this.db.query(
      `INSERT INTO screen_share_sessions_v2(call_id,presenter_user_id,presenter_device_id,share_type)
       VALUES($1,$2,$3,$4) RETURNING id,status,created_at`,
      [input.callId, input.userId, input.deviceId, input.shareType]
    );
    return result.rows[0];
  }

  async decideScreenShare(sessionId: string, userId: string, consented: boolean) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const session = await client.query(
        `SELECT s.id FROM screen_share_sessions_v2 s JOIN call_sessions c ON c.id=s.call_id
         WHERE s.id=$1 AND (c.caller_user_id=$2 OR c.callee_user_id=$2) FOR UPDATE`,
        [sessionId, userId]
      );
      if (session.rowCount !== 1) throw new Error("screen_share_not_found");
      await client.query(
        `INSERT INTO screen_share_consents_v2(session_id,user_id,consented) VALUES($1,$2,$3)
         ON CONFLICT(session_id,user_id) DO UPDATE SET consented=EXCLUDED.consented,decided_at=now()`,
        [sessionId, userId, consented]
      );
      await client.query(`UPDATE screen_share_sessions_v2 SET status=$2 WHERE id=$1`, [sessionId, consented ? "ACTIVE" : "REJECTED"]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listWallet(userId: string) {
    const result = await this.db.query(
      `SELECT id,item_type,data_ciphertext,created_at FROM wallet_items_v2 WHERE user_id=$1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows.map((row) => ({ ...row, data_ciphertext: (row.data_ciphertext as Buffer).toString("base64") }));
  }

  async addWalletItem(userId: string, itemType: string, ciphertext: Buffer) {
    const result = await this.db.query(
      `INSERT INTO wallet_items_v2(user_id,item_type,data_ciphertext) VALUES($1,$2,$3)
       RETURNING id,item_type,created_at`,
      [userId, itemType, ciphertext]
    );
    return result.rows[0];
  }

  async createCommunity(userId: string, name: string, visibility: "PRIVATE" | "INVITE_ONLY" | "PUBLIC") {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const community = await client.query(
        `INSERT INTO communities(owner_user_id,name,visibility) VALUES($1,$2,$3) RETURNING id,name,visibility,created_at`,
        [userId, name, visibility]
      );
      await client.query(
        `INSERT INTO community_memberships(community_id,user_id,role) VALUES($1,$2,'OWNER')`,
        [community.rows[0].id, userId]
      );
      await client.query("COMMIT");
      return community.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async joinCommunity(communityId: string, userId: string) {
    await this.db.query(
      `INSERT INTO community_memberships(community_id,user_id,role,status)
       SELECT id,$2,'MEMBER','ACTIVE' FROM communities WHERE id=$1 AND status='ACTIVE'
       ON CONFLICT(community_id,user_id) DO UPDATE SET status='ACTIVE'`,
      [communityId, userId]
    );
  }

  async createOrganization(userId: string, name: string, slug: string) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const organization = await client.query(
        `INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id,name,slug,created_at`,
        [name, slug]
      );
      await client.query(
        `INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'OWNER')`,
        [organization.rows[0].id, userId]
      );
      await client.query("COMMIT");
      return organization.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async triggerEmergency(input: { userId: string; deviceId?: string; eventType: string; encryptedPayload?: Buffer }) {
    const result = await this.db.query(
      `INSERT INTO emergency_events(owner_user_id,triggered_from_device_id,event_type,encrypted_payload)
       VALUES($1,$2,$3,$4) RETURNING id,state,event_type,created_at`,
      [input.userId, input.deviceId ?? null, input.eventType, input.encryptedPayload ?? null]
    );
    return result.rows[0];
  }
}