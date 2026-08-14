import type { Database } from "../db/pool.js";
import type { SessionIssuer } from "./account-switch.service.js";

export class AccountSwitchV3Service {
  constructor(private readonly db: Database, private readonly sessions: SessionIssuer) {}

  async list(installationId: string, currentUserId: string) {
    const access = await this.db.query(
      `SELECT 1 FROM installation_accounts_v2
       WHERE installation_id=$1 AND user_id=$2 AND state='ACTIVE'`,
      [installationId, currentUserId]
    );
    if (access.rowCount !== 1) throw new Error("installation_access_denied");
    const result = await this.db.query(
      `SELECT ia.user_id,ia.account_slot,ia.label,
              ph.country_iso2,ph.national_number_suffix,
              recovery.masked_email,crypto.local_db_name
       FROM installation_accounts_v2 ia
       LEFT JOIN phone_identities_v2 ph ON ph.user_id=ia.user_id
       LEFT JOIN recovery_email_identities_v3 recovery ON recovery.user_id=ia.user_id
       LEFT JOIN account_crypto_namespaces_v3 crypto
         ON crypto.installation_id=ia.installation_id AND crypto.user_id=ia.user_id
       WHERE ia.installation_id=$1 AND ia.state='ACTIVE'
       ORDER BY ia.account_slot`,
      [installationId]
    );
    return result.rows;
  }

  async switch(input: { installationId: string; currentUserId: string; targetUserId: string; deviceId: string }) {
    const target = await this.db.query(
      `SELECT ia.account_slot,crypto.local_db_name
       FROM installation_accounts_v2 ia
       JOIN account_crypto_namespaces_v3 crypto
         ON crypto.installation_id=ia.installation_id AND crypto.user_id=ia.user_id
       JOIN trusted_installation_devices_v3 trusted
         ON trusted.installation_id=ia.installation_id AND trusted.user_id=ia.user_id
       WHERE ia.installation_id=$1 AND ia.user_id=$2 AND ia.state='ACTIVE'
         AND trusted.device_id=$3 AND trusted.trust_state='TRUSTED'`,
      [input.installationId, input.targetUserId, input.deviceId]
    );
    if (target.rowCount !== 1) throw new Error("target_account_or_device_unavailable");
    const session = await this.sessions.issueForAccount({
      userId: input.targetUserId,
      deviceId: input.deviceId,
      installationId: input.installationId
    });
    await this.db.query(
      `INSERT INTO active_account_context_v3(installation_id,active_user_id,active_session_id)
       VALUES($1,$2,$3) ON CONFLICT(installation_id) DO UPDATE SET
         active_user_id=EXCLUDED.active_user_id,
         active_session_id=EXCLUDED.active_session_id,switched_at=now()`,
      [input.installationId, input.targetUserId, session.sessionId]
    );
    await this.db.query(
      `INSERT INTO account_switch_events_v2(
         installation_id,from_user_id,to_user_id,device_id,session_id
       ) VALUES($1,$2,$3,$4,$5)`,
      [input.installationId, input.currentUserId, input.targetUserId, input.deviceId, session.sessionId]
    );
    return {
      accountSlot: Number(target.rows[0].account_slot),
      localDbName: target.rows[0].local_db_name,
      session
    };
  }
}
