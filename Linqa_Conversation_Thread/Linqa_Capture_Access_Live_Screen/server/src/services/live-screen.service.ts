import type { Database } from "../db/pool.js";

export class LiveScreenService {
  constructor(private readonly db: Database) {}

  async offer(input: {
    id: string;
    conversationId: string;
    userId: string;
    deviceId: string;
    offerEnvelope: Buffer;
  }) {
    await this.requireMember(input.userId, input.conversationId);
    if (input.offerEnvelope.length < 32) throw new Error("SCREEN_OFFER_INVALID");
    await this.db.query(
      `INSERT INTO live_screen_sessions(
         id,conversation_id,host_user_id,host_device_id,state,offer_envelope
       ) VALUES($1,$2,$3,$4,'OFFERED',$5)`,
      [input.id, input.conversationId, input.userId, input.deviceId, input.offerEnvelope],
    );
    return { id: input.id, state: "OFFERED" };
  }

  async answer(input: { id: string; userId: string; accept: boolean; answerEnvelope?: Buffer }) {
    const row = await this.db.query(
      `SELECT conversation_id,host_user_id,state FROM live_screen_sessions WHERE id=$1`,
      [input.id],
    );
    if (row.rowCount !== 1) throw new Error("SCREEN_SESSION_NOT_FOUND");
    await this.requireMember(input.userId, row.rows[0].conversation_id);
    if (row.rows[0].host_user_id === input.userId) throw new Error("SCREEN_HOST_CANNOT_ANSWER");
    if (!input.accept) {
      await this.db.query(
        `UPDATE live_screen_sessions SET state='DECLINED', stopped_at=now() WHERE id=$1 AND state='OFFERED'`,
        [input.id],
      );
      return { id: input.id, state: "DECLINED" };
    }
    if (!input.answerEnvelope || input.answerEnvelope.length < 32) throw new Error("SCREEN_ANSWER_INVALID");
    await this.db.query(
      `UPDATE live_screen_sessions SET state='ACTIVE', answer_envelope=$2 WHERE id=$1 AND state='OFFERED'`,
      [input.id, input.answerEnvelope],
    );
    return { id: input.id, state: "ACTIVE" };
  }

  async stop(id: string, userId: string) {
    const updated = await this.db.query(
      `UPDATE live_screen_sessions
          SET state='STOPPED', stopped_at=now(), offer_envelope=NULL, answer_envelope=NULL
        WHERE id=$1 AND host_user_id=$2 AND state IN ('OFFERED','ACTIVE')`,
      [id, userId],
    );
    if (updated.rowCount !== 1) throw new Error("SCREEN_SESSION_NOT_ACTIVE");
    return { id, state: "STOPPED" };
  }

  private async requireMember(userId: string, conversationId: string) {
    const result = await this.db.query(
      `SELECT 1 FROM chat_members WHERE thread_id=$1 AND user_id=$2`,
      [conversationId, userId],
    );
    if (result.rowCount !== 1) throw new Error("conversation access denied");
  }
}
