import type { Database } from "../db/pool.js";
import { ChatError, assertMember, withTransaction } from "./chat.service.js";

const MIN_ENVELOPE = 32;
const MAX_ENVELOPE = 65_536;
/** An offer nobody answers lapses after this long. */
export const OFFER_TTL_SECONDS = 300;
/** A share that has been running this long is closed. */
export const MAX_ACTIVE_SECONDS = 4 * 3600;

export type ScreenState = "OFFERED" | "ACTIVE" | "STOPPED" | "DECLINED";
export type ScreenSession = { id: string; state: "OFFERED" | "ACTIVE"; hostUserId: string; createdAt: string; envelope: Buffer | null };

const iso = (d: Date) => new Date(d).toISOString();

/**
 * Signaling for a live screen share between the two people in a conversation. It relays two sealed envelopes and keeps
 * the session's state; it never sees a frame. Only members can offer, answer, stop or look, the host cannot answer their own
 * offer, and the envelopes are erased the moment a session ends.
 */
export class LiveScreenService {
  constructor(private readonly db: Database) {}

  /** Closes what has lapsed in this conversation: unanswered offers and shares that ran too long. */
  private async sweep(client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, conversationId: string) {
    await client.query(
      `UPDATE live_screen_sessions SET state = 'STOPPED', stopped_at = now(), offer_envelope = NULL, answer_envelope = NULL
        WHERE conversation_id = $1 AND (
          (state = 'OFFERED' AND created_at < now() - make_interval(secs => $2::int))
          OR (state = 'ACTIVE' AND answered_at < now() - make_interval(secs => $3::int)))`,
      [conversationId, OFFER_TTL_SECONDS, MAX_ACTIVE_SECONDS]
    );
  }

  /** Offers to share the host's screen. Repeating the same id returns the original; a second open share is refused. */
  async offer(input: { id: string; conversationId: string; userId: string; deviceId?: string | null; offerEnvelope: Buffer }): Promise<{ id: string; state: "OFFERED"; duplicate: boolean }> {
    if (input.offerEnvelope.length < MIN_ENVELOPE || input.offerEnvelope.length > MAX_ENVELOPE) throw new ChatError(422, "SCREEN_OFFER_INVALID");
    return withTransaction(this.db, async (client) => {
      await assertMember(client, input.userId, input.conversationId);
      await this.sweep(client, input.conversationId);
      const same = await client.query(`SELECT host_user_id AS "host", conversation_id AS "conversationId", state FROM live_screen_sessions WHERE id = $1`, [input.id]);
      const existing = same.rows[0] as { host: string; conversationId: string; state: string } | undefined;
      if (existing) {
        if (existing.host !== input.userId || existing.conversationId !== input.conversationId) throw new ChatError(409, "SCREEN_SESSION_ID_TAKEN");
        if (existing.state === "OFFERED") return { id: input.id, state: "OFFERED" as const, duplicate: true };
        throw new ChatError(409, "SCREEN_SESSION_ID_TAKEN");
      }
      const open = await client.query(`SELECT 1 FROM live_screen_sessions WHERE conversation_id = $1 AND state IN ('OFFERED','ACTIVE')`, [input.conversationId]);
      if (open.rowCount) throw new ChatError(409, "SCREEN_SHARE_IN_PROGRESS");
      await client.query(
        `INSERT INTO live_screen_sessions (id, conversation_id, host_user_id, host_device_id, state, offer_envelope) VALUES ($1,$2,$3,$4,'OFFERED',$5)`,
        [input.id, input.conversationId, input.userId, input.deviceId ?? null, input.offerEnvelope]
      );
      return { id: input.id, state: "OFFERED" as const, duplicate: false };
    });
  }

  /** The other person accepts (with their sealed answer) or declines. Only an offer that is still open can be answered. */
  async answer(input: { id: string; userId: string; accept: boolean; answerEnvelope?: Buffer }): Promise<{ id: string; state: "ACTIVE" | "DECLINED" }> {
    return withTransaction(this.db, async (client) => {
      const found = await client.query(`SELECT conversation_id AS "conversationId" FROM live_screen_sessions WHERE id = $1`, [input.id]);
      const conversationId = (found.rows[0] as { conversationId: string } | undefined)?.conversationId;
      if (!conversationId) throw new ChatError(404, "SCREEN_SESSION_NOT_FOUND");
      await assertMember(client, input.userId, conversationId);
      await this.sweep(client, conversationId);
      const row = await client.query(`SELECT host_user_id AS "host" FROM live_screen_sessions WHERE id = $1 AND state = 'OFFERED' FOR UPDATE`, [input.id]);
      const session = row.rows[0] as { host: string } | undefined;
      if (!session) throw new ChatError(404, "SCREEN_SESSION_NOT_FOUND");
      if (session.host === input.userId) throw new ChatError(422, "SCREEN_HOST_CANNOT_ANSWER");
      if (!input.accept) {
        await client.query(`UPDATE live_screen_sessions SET state = 'DECLINED', stopped_at = now(), offer_envelope = NULL, answer_envelope = NULL WHERE id = $1`, [input.id]);
        return { id: input.id, state: "DECLINED" as const };
      }
      if (!input.answerEnvelope || input.answerEnvelope.length < MIN_ENVELOPE || input.answerEnvelope.length > MAX_ENVELOPE) throw new ChatError(422, "SCREEN_ANSWER_INVALID");
      await client.query(`UPDATE live_screen_sessions SET state = 'ACTIVE', answer_envelope = $2, answered_at = now() WHERE id = $1`, [input.id, input.answerEnvelope]);
      return { id: input.id, state: "ACTIVE" as const };
    });
  }

  /** Either person can end it: the host stops sharing, the viewer leaves. */
  async stop(id: string, userId: string): Promise<{ id: string; state: "STOPPED" }> {
    return withTransaction(this.db, async (client) => {
      const found = await client.query(`SELECT conversation_id AS "conversationId" FROM live_screen_sessions WHERE id = $1 AND state IN ('OFFERED','ACTIVE') FOR UPDATE`, [id]);
      const conversationId = (found.rows[0] as { conversationId: string } | undefined)?.conversationId;
      if (!conversationId) throw new ChatError(404, "SCREEN_SESSION_NOT_FOUND");
      await assertMember(client, userId, conversationId);
      await client.query(`UPDATE live_screen_sessions SET state = 'STOPPED', stopped_at = now(), offer_envelope = NULL, answer_envelope = NULL WHERE id = $1`, [id]);
      return { id, state: "STOPPED" as const };
    });
  }

  /**
   * The share open in this conversation, if any. The viewer gets the host's offer to answer; the host gets the viewer's answer
   * once there is one. Nobody else gets either.
   */
  async current(userId: string, conversationId: string): Promise<ScreenSession | null> {
    return withTransaction(this.db, async (client) => {
      await assertMember(client, userId, conversationId);
      await this.sweep(client, conversationId);
      const result = await client.query(
        `SELECT id, state, host_user_id AS "hostUserId", created_at AS "createdAt", offer_envelope AS "offer", answer_envelope AS "answer"
           FROM live_screen_sessions WHERE conversation_id = $1 AND state IN ('OFFERED','ACTIVE') LIMIT 1`, [conversationId]
      );
      const r = result.rows[0] as { id: string; state: "OFFERED" | "ACTIVE"; hostUserId: string; createdAt: Date; offer: Buffer | null; answer: Buffer | null } | undefined;
      if (!r) return null;
      return { id: r.id, state: r.state, hostUserId: r.hostUserId, createdAt: iso(r.createdAt), envelope: r.hostUserId === userId ? r.answer : r.offer };
    });
  }
}
