import type { Database } from "../db/pool.js";

const NEXT: Record<string, string[]> = {
  RINGING: ["ACCEPTED", "REJECTED", "ENDED", "FAILED"],
  ACCEPTED: ["ACTIVE", "ENDED", "FAILED"],
  ACTIVE: ["ENDED", "FAILED"],
};

export class CallBackend {
  constructor(private readonly db: Database) {}

  async create(input: {
    id: string;
    callerId: string;
    peerUserId: string;
    callType: "AUDIO" | "VIDEO";
    privacyMode: "STANDARD" | "RELAY_ONLY";
  }) {
    await this.db.query(
      `INSERT INTO calls(id,caller_id,peer_user_id,call_type,privacy_mode,state)
       VALUES($1,$2,$3,$4,$5,'RINGING')`,
      [input.id, input.callerId, input.peerUserId, input.callType, input.privacyMode],
    );
    return { id: input.id, state: "RINGING" };
  }

  async transition(callId: string, userId: string, state: string) {
    const row = await this.db.query(
      `SELECT caller_id,peer_user_id,state FROM calls WHERE id=$1`,
      [callId],
    );
    if (row.rowCount !== 1) throw new Error("CALL_NOT_FOUND");
    const call = row.rows[0];
    if (call.caller_id !== userId && call.peer_user_id !== userId) throw new Error("CALL_ACCESS_DENIED");
    if (!NEXT[call.state]?.includes(state)) throw new Error("CALL_STATE_INVALID");
    await this.db.query(
      `UPDATE calls SET state=$2, updated_at=now() WHERE id=$1`,
      [callId, state],
    );
    return { id: callId, state };
  }

  async get(callId: string, userId: string) {
    const row = await this.db.query(
      `SELECT id,call_type,privacy_mode,state,caller_id,peer_user_id,created_at
         FROM calls WHERE id=$1`,
      [callId],
    );
    if (row.rowCount !== 1) throw new Error("CALL_NOT_FOUND");
    const call = row.rows[0];
    if (call.caller_id !== userId && call.peer_user_id !== userId) throw new Error("CALL_ACCESS_DENIED");
    return call;
  }
}
