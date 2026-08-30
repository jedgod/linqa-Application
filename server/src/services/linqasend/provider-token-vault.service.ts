import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "../../db/pool.js";
import type { ProductionKmsProvider } from "../../security/kms/production-kms-provider.js";

const prefix = "vault:";

/** KMS envelope-encrypted provider-token storage with purpose-bound access audit. */
export class ProviderTokenVaultService {
  constructor(private readonly db: Database, private readonly kms: ProductionKmsProvider, private readonly keyId: string) {}

  async store(input: { ownerUserId: string; providerId: string; secretKind: string; plaintext: string; maskedDisplay?: string }): Promise<string> {
    const id = randomUUID();
    const context = { linqasend_secret_id: id, provider_id: input.providerId, secret_kind: input.secretKind };
    const dataKey = await this.kms.generateDataKey({ context });
    const nonce = randomBytes(12);
    try {
      const cipher = createCipheriv("aes-256-gcm", dataKey.plaintext, nonce);
      cipher.setAAD(Buffer.from(JSON.stringify(context)));
      const ciphertext = Buffer.concat([cipher.update(input.plaintext,"utf8"),cipher.final()]);
      const tag = cipher.getAuthTag();
      await this.db.query(`INSERT INTO linqasend_provider_secrets(id,owner_user_id,provider_id,secret_kind,encrypted_data_key,ciphertext,nonce,auth_tag,masked_display,key_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id,input.ownerUserId,input.providerId,input.secretKind,dataKey.ciphertext,ciphertext,nonce,tag,input.maskedDisplay ?? null,this.keyId]);
      return `${prefix}${id}`;
    } finally { dataKey.plaintext.fill(0); }
  }

  async resolve(reference: string, input: { actorId: string; purpose: string; expectedOwnerUserId?: string }): Promise<string> {
    if (!reference.startsWith(prefix)) throw new Error("PLAINTEXT_PROVIDER_REFERENCE_FORBIDDEN");
    const id = reference.slice(prefix.length);
    const result = await this.db.query(`SELECT * FROM linqasend_provider_secrets WHERE id=$1 AND revoked_at IS NULL`, [id]);
    const row = result.rows[0];
    if (!row || (input.expectedOwnerUserId && row.owner_user_id !== input.expectedOwnerUserId)) throw new Error("PROVIDER_SECRET_NOT_FOUND");
    const context = { linqasend_secret_id: id, provider_id: row.provider_id as string, secret_kind: row.secret_kind as string };
    const dataKey = await this.kms.decrypt({ ciphertext: Buffer.from(row.encrypted_data_key), context });
    try {
      const decipher = createDecipheriv("aes-256-gcm",dataKey,Buffer.from(row.nonce));
      decipher.setAAD(Buffer.from(JSON.stringify(context))); decipher.setAuthTag(Buffer.from(row.auth_tag));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(row.ciphertext)),decipher.final()]).toString("utf8");
      await this.db.query(`INSERT INTO linqasend_provider_secret_access_audit(secret_id,actor_type,actor_id,purpose) VALUES($1,'SERVICE',$2,$3)`, [id,input.actorId,input.purpose]);
      return plaintext;
    } finally { dataKey.fill(0); }
  }
}
