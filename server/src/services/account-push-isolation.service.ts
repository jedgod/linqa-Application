import { createHash } from "node:crypto";
import type { Database } from "../db/pool.js";

export interface PushTokenCipher {
  encrypt(token: string): Promise<Buffer>;
}

export class AccountPushIsolationService {
  constructor(
    private readonly db: Database,
    private readonly cipher: PushTokenCipher
  ) {}

  async bind(input: {
    installationId: string;
    userId: string;
    deviceId: string;
    provider: "APNS" | "FCM" | "WEB_PUSH";
    token: string;
  }) {
    const membership = await this.db.query(
      `SELECT 1 FROM installation_accounts_v2
       WHERE installation_id=$1
         AND user_id=$2
         AND state='ACTIVE'`,
      [input.installationId, input.userId]
    );

    if (membership.rowCount !== 1) {
      throw new Error("account_not_bound_to_installation");
    }

    const ciphertext = await this.cipher.encrypt(input.token);
    const hash = createHash("sha256").update(input.token).digest();

    await this.db.query(
      `INSERT INTO account_push_bindings_v2(
         installation_id,user_id,device_id,provider,
         token_hash,token_ciphertext,active
       ) VALUES($1,$2,$3,$4,$5,$6,TRUE)
       ON CONFLICT(installation_id,user_id,provider)
       DO UPDATE SET
         device_id=EXCLUDED.device_id,
         token_hash=EXCLUDED.token_hash,
         token_ciphertext=EXCLUDED.token_ciphertext,
         active=TRUE,
         updated_at=now()`,
      [input.installationId, input.userId, input.deviceId, input.provider, hash, ciphertext]
    );
  }

  async activeBindings(installationId: string, userId: string) {
    const result = await this.db.query(
      `SELECT provider,device_id,updated_at
       FROM account_push_bindings_v2
       WHERE installation_id=$1
         AND user_id=$2
         AND active=TRUE`,
      [installationId, userId]
    );

    return result.rows;
  }
}
