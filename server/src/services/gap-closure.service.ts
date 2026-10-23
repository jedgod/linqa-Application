import type { Database } from "../db/pool.js";

export class GapClosureService {
  constructor(private readonly db: Database) {}

  async listCalls(userId:string,limit=100) {
    const result=await this.db.query(
      `SELECT h.*,p.display_name FROM call_history h
       LEFT JOIN user_profiles p ON p.user_id=h.peer_user_id
       WHERE h.user_id=$1 ORDER BY h.created_at DESC LIMIT $2`,
      [userId,limit]
    );
    return result.rows;
  }

  async listMedia(input:{userId:string;mediaType?:string;starredOnly?:boolean;limit:number}) {
    const values:unknown[]=[input.userId];
    const filters=["user_id=$1","(expires_at IS NULL OR expires_at>now())"];
    if(input.mediaType){values.push(input.mediaType);filters.push(`media_type=$${values.length}`);}
    if(input.starredOnly)filters.push("starred=TRUE");
    values.push(input.limit);
    const result=await this.db.query(
      `SELECT * FROM media_index WHERE ${filters.join(" AND ")}
       ORDER BY created_at DESC LIMIT $${values.length}`,
      values
    );
    return result.rows;
  }

  async privacySummary(userId:string) {
    const [devices,sessions,blocks,settings]=await Promise.all([
      this.db.query(`SELECT id,device_name,platform,status,last_seen_at,registered_at FROM devices WHERE user_id=$1 ORDER BY registered_at DESC`,[userId]),
      this.db.query(`SELECT id,device_id,issued_at AS created_at,expires_at,revoked_at FROM auth_sessions WHERE user_id=$1 ORDER BY issued_at DESC`,[userId]),
      this.db.query(`SELECT blocked_user_id,created_at FROM blocked_users WHERE blocker_user_id=$1`,[userId]),
      this.db.query(`SELECT * FROM privacy_settings WHERE user_id=$1`,[userId])
    ]);
    const activeDevices=devices.rows.filter(r=>r.status==="ACTIVE").length;
    const activeSessions=sessions.rows.filter(r=>!r.revoked_at).length;
    return {
      devices:devices.rows,
      sessions:sessions.rows,
      blockedUsers:blocks.rows,
      privacySettings:settings.rows[0]??null,
      privacyScore:Math.max(0,Math.min(100,40+Math.min(activeDevices,3)*10+(activeSessions<=activeDevices?10:0)))
    };
  }
}
