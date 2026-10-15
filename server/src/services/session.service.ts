import type { Database } from "../db/pool.js";
import type { AppConfig } from "../config.js";
import { hashToken, issueAccessToken, randomToken } from "../auth/tokens.js";
import { assertActivePrincipal, InactivePrincipalError } from "../auth/active-principal.js";

export class InvalidRefreshTokenError extends Error {}

export class SessionService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig
  ) {}

  async create(input: {
    userId: string;
    subject: string;
    deviceId?: string;
    scopes: string[];
    ipHash?: Buffer;
    userAgentHash?: Buffer;
  }) {
    const refreshToken = randomToken(48);
    const refreshHash = hashToken(refreshToken);
    const familyId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const inserted = await this.db.query(
      `INSERT INTO auth_sessions (
         user_id,
         device_id,
         token_family_id,
         refresh_token_hash,
         access_scope,
         expires_at,
         ip_hash,
         user_agent_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        input.userId,
        input.deviceId ?? null,
        familyId,
        refreshHash,
        input.scopes,
        expiresAt,
        input.ipHash ?? null,
        input.userAgentHash ?? null
      ]
    );

    const sessionId = inserted.rows[0].id as string;
    const accessToken = await issueAccessToken(this.config, {
      userId: input.userId,
      subject: input.subject,
      scopes: input.scopes,
      sessionId,
      ...(input.deviceId !== undefined ? { deviceId: input.deviceId } : {})
    });

    return {
      accessToken,
      accessTokenExpiresIn: 900,
      refreshToken,
      refreshTokenExpiresAt: expiresAt,
      sessionId
    };
  }

  async rotate(input: {
    refreshToken: string;
  }) {
    const presentedHash = hashToken(input.refreshToken);
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `SELECT s.*, u.external_subject
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.refresh_token_hash = $1
            OR s.previous_refresh_token_hash = $1
         FOR UPDATE`,
        [presentedHash]
      );
      const row = result.rows[0];

      if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
        throw new InvalidRefreshTokenError("invalid refresh token");
      }

      try {
        await assertActivePrincipal(client, { subject: row.external_subject, userId: row.user_id, sessionId: row.id,
          scopes: new Set<string>(row.access_scope), ...(row.device_id ? { deviceId: row.device_id as string } : {}) });
      } catch (error) {
        if (error instanceof InactivePrincipalError) throw new InvalidRefreshTokenError("inactive refresh session");
        throw error; // Preserve temporary database failures; they must not look like invalid credentials.
      }

      if (
        row.previous_refresh_token_hash &&
        Buffer.compare(row.previous_refresh_token_hash, presentedHash) === 0
      ) {
        await client.query(
          `UPDATE auth_sessions
           SET revoked_at = now(), revoke_reason = 'REFRESH_TOKEN_REUSE'
           WHERE token_family_id = $1 AND revoked_at IS NULL`,
          [row.token_family_id]
        );
        await client.query("COMMIT");
        throw new InvalidRefreshTokenError("refresh token reuse detected");
      }

      const nextRefreshToken = randomToken(48);
      const nextHash = hashToken(nextRefreshToken);

      // Sign before committing rotation so a signing outage does not invalidate
      // the only refresh token the device still has.
      const accessToken = await issueAccessToken(this.config, {
        userId: row.user_id,
        subject: row.external_subject,
        deviceId: row.device_id ?? undefined,
        scopes: row.access_scope,
        sessionId: row.id
      });

      await client.query(
        `UPDATE auth_sessions
         SET previous_refresh_token_hash = refresh_token_hash,
             refresh_token_hash = $1,
             last_used_at = now()
         WHERE id = $2`,
        [nextHash, row.id]
      );

      await client.query("COMMIT");

      return {
        accessToken,
        accessTokenExpiresIn: 900,
        refreshToken: nextRefreshToken
      };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeSession(sessionId: string, reason = "USER_LOGOUT"): Promise<void> {
    await this.db.query(
      `UPDATE auth_sessions
       SET revoked_at = now(), revoke_reason = $2
       WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, reason]
    );
  }
}
