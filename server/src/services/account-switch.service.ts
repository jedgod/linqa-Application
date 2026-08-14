import type { Database } from "../db/pool.js";

export interface SessionIssuer {
  issueForAccount(input: { userId: string; deviceId: string; installationId: string }): Promise<{
    accessToken: string;
    refreshToken: string;
    sessionId: string;
    expiresAt: string;
  }>;
}

export class AccountSwitchService {
  constructor(
    private readonly db: Database,
    private readonly issuer: SessionIssuer
  ) {}

  async switch(input: { installationId: string; fromUserId?: string; toUserId: string; deviceId: string }) {
    const membership = await this.db.query(
      `SELECT 1
       FROM installation_accounts_v2
       WHERE installation_id=$1
         AND user_id=$2
         AND state='ACTIVE'`,
      [input.installationId, input.toUserId]
    );

    if (membership.rowCount !== 1) {
      throw new Error("account_not_available_on_installation");
    }

    const session = await this.issuer.issueForAccount({
      userId: input.toUserId,
      deviceId: input.deviceId,
      installationId: input.installationId
    });

    await this.db.query(
      `INSERT INTO account_switch_events_v2(
         installation_id,from_user_id,to_user_id,
         device_id,session_id
       ) VALUES($1,$2,$3,$4,$5)`,
      [input.installationId, input.fromUserId ?? null, input.toUserId, input.deviceId, session.sessionId]
    );

    return session;
  }
}
