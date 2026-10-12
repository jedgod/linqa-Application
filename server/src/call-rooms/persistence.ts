import type { Database } from "../db/pool.js";
import type { CallRecord } from "./calls.store.js";
import type { CallReport, ReportsRepository } from "./reports.service.js";
export function serialize(call: CallRecord): string {
  return JSON.stringify({ ...call, participants:[...call.participants], invited:[...call.invited], everJoined:[...call.everJoined], everInvited:[...call.everInvited], envelopes:[...call.envelopes] });
}
export function hydrate(raw: any): CallRecord {
  return { ...raw, participants:new Map(raw.participants), invited:new Set(raw.invited), everJoined:new Set(raw.everJoined), everInvited:new Set(raw.everInvited), envelopes:new Map(raw.envelopes) };
}
export class RoomPersistence {
  private saved = new Map<string,string>();
  constructor(private readonly db: Database) {}
  async save(calls: Iterable<CallRecord>): Promise<void> {
    for (const call of calls) {
      const json = serialize(call); if (this.saved.get(call.callId) === json) continue;
      const state = JSON.parse(json);
      // Snapshot before awaiting: timers can change the in-memory call during SQL I/O.
      const snapshot = hydrate(state);
      const owner = [...snapshot.participants.values()].find(p => p.userId === snapshot.createdBy);
      const client = await this.db.connect();
      try {
        await client.query("BEGIN");
        if (owner) await client.query(`INSERT INTO call_sessions (id,initiator_user_id,initiator_device_id,mode,status,privacy_mode,call_type,created_at)
          VALUES ($1,$2,$3,'LIVE','CREATED','RELAY_ONLY',$4,$5) ON CONFLICT (id) DO NOTHING`,[snapshot.callId,snapshot.createdBy,owner.deviceId,snapshot.kind === 'video' ? 'VIDEO' : 'AUDIO',new Date(snapshot.createdAt)]);
        await client.query(`UPDATE call_sessions SET status=$2,started_at=$3,ended_at=$4 WHERE id=$1`,[snapshot.callId,snapshot.endedAt ? 'ENDED' : snapshot.answeredAt ? 'ACTIVE' : 'CREATED',snapshot.answeredAt ? new Date(snapshot.answeredAt) : null,snapshot.endedAt ? new Date(snapshot.endedAt) : null]);
        for (const p of snapshot.participants.values()) await client.query(`INSERT INTO call_participants (call_id,user_id,device_id,role,joined_at)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT (call_id,device_id) DO UPDATE SET joined_at=EXCLUDED.joined_at,left_at=NULL`,[snapshot.callId,p.userId,p.deviceId,p.userId === snapshot.createdBy ? 'CALLER' : 'CALLEE',new Date(p.joinedAt)]);
        const ids=[...snapshot.participants.values()].map(p=>p.deviceId);
        await client.query(`UPDATE call_participants SET left_at=COALESCE(left_at,now()) WHERE call_id=$1 AND (NOT(device_id=ANY($2::uuid[])) OR $3::boolean)`,[snapshot.callId,ids,!!snapshot.endedAt]);
        if(snapshot.endedAt) await client.query(`INSERT INTO call_history(call_id,user_id,peer_user_id,direction,call_type,status,started_at,ended_at,duration_seconds)
          SELECT DISTINCT ON (p.user_id) p.call_id,p.user_id,peer.user_id,CASE p.role WHEN 'CALLER' THEN 'OUTGOING' ELSE 'INCOMING' END,$2,$3,$4,$5,$6
          FROM call_participants p LEFT JOIN call_participants peer ON peer.call_id=p.call_id AND peer.user_id<>p.user_id
          WHERE p.call_id=$1 ORDER BY p.user_id,peer.joined_at NULLS LAST
          ON CONFLICT(call_id,user_id) WHERE call_id IS NOT NULL DO NOTHING`,[snapshot.callId,snapshot.kind==='video'?'VIDEO':'AUDIO',snapshot.answeredAt?'COMPLETED':snapshot.endReason==='declined'?'REJECTED':snapshot.endReason==='error'?'FAILED':'CANCELLED',new Date(snapshot.answeredAt??snapshot.createdAt),new Date(snapshot.endedAt),snapshot.answeredAt?Math.floor((snapshot.endedAt-snapshot.answeredAt)/1000):0]);
        await client.query(`INSERT INTO secure_call_rooms(call_id,state) VALUES ($1,$2::jsonb) ON CONFLICT(call_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()`,[snapshot.callId,json]);
        await client.query("COMMIT"); this.saved.set(snapshot.callId,json);
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }
  }
}
export class SqlReportsRepository implements ReportsRepository {
  constructor(private readonly db: Database) {}
  async exists(callId: string, reporter: string, reported: string): Promise<boolean> {
    return !!(await this.db.query(`SELECT 1 FROM secure_call_report_subjects WHERE call_id=$1 AND reporter_user_id=$2 AND reported_user_id=$3`,[callId,reporter,reported])).rowCount;
  }
  async insert(report: CallReport): Promise<void> {
    const client=await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO secure_call_reports(id,call_id,reporter_user_id,metadata) VALUES ($1,$2,$3,$4::jsonb)`,[report.id,report.callId,report.reporterUserId,JSON.stringify(report)]);
      for(const user of report.reportedUserIds) await client.query(`INSERT INTO secure_call_report_subjects(call_id,reporter_user_id,reported_user_id,report_id) VALUES ($1,$2,$3,$4)`,[report.callId,report.reporterUserId,user,report.id]);
      await client.query('COMMIT');
    } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
