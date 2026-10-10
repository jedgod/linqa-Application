import crypto, { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { BiometricPurpose, DeviceTrust, Principal, RiskEngine } from './types';
import { resourceHash, signingPayload } from './canonical';

const CHALLENGE_TTL_MS = 90_000;
const GRANT_TTL_MS = 120_000;

function sha256(v: Buffer | string) {
  return crypto.createHash('sha256').update(v).digest();
}

export class BiometricStepUpService {
  constructor(
    private readonly db: Pool,
    private readonly risk: RiskEngine,
    private readonly getDeviceTrust: (p: Principal) => Promise<DeviceTrust>,
  ) {}

  async enroll(input: {
    principal: Principal;
    platform: 'IOS'|'ANDROID';
    publicKeySpkiBase64: string;
    keyAlias: string;
  }) {
    const trust = await this.getDeviceTrust(input.principal);
    if (!trust.trusted || trust.compromised) throw new Error('DEVICE_NOT_TRUSTED');

    const spki = Buffer.from(input.publicKeySpkiBase64, 'base64');
    const key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec') throw new Error('INVALID_KEY_TYPE');

    const id = randomUUID();
    await this.db.query(
      `INSERT INTO biometric_credentials
       (id,user_id,device_id,platform,algorithm,public_key_spki,key_alias,biometric_class)
       VALUES ($1,$2,$3,$4,'P256_SHA256',$5,$6,'STRONG')`,
      [id,input.principal.userId,input.principal.deviceId,input.platform,spki,input.keyAlias]
    );
    await this.audit(input.principal,id,'ENROLL',undefined,undefined,true);
    return { credentialId:id };
  }

  async createChallenge(input: {
    principal: Principal;
    purpose: BiometricPurpose;
    resource: unknown;
  }) {
    const trust = await this.getDeviceTrust(input.principal);
    if (!trust.trusted || trust.compromised) throw new Error('DEVICE_NOT_TRUSTED');

    const risk = await this.risk.assess(input);
    if (!risk.allow) throw new Error(risk.reason ?? 'RISK_DENIED');

    const cred = await this.db.query(
      `SELECT id FROM biometric_credentials
       WHERE user_id=$1 AND device_id=$2 AND revoked_at IS NULL
       ORDER BY enrolled_at DESC LIMIT 1`,
      [input.principal.userId,input.principal.deviceId]
    );
    if (!cred.rowCount) throw new Error('BIOMETRIC_NOT_ENROLLED');

    const challenge = randomBytes(32).toString('base64url');
    const rh = resourceHash(input.resource);
    const id = randomUUID();
    const expiresAt = new Date(Date.now()+CHALLENGE_TTL_MS);

    await this.db.query(
      `INSERT INTO biometric_challenges
       (id,user_id,device_id,credential_id,purpose,resource_hash,challenge_hash,expires_at,risk_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id,input.principal.userId,input.principal.deviceId,cred.rows[0].id,input.purpose,rh,
       sha256(challenge),expiresAt,JSON.stringify({score:risk.score})]
    );

    return {
      challengeId:id,
      challenge,
      purpose:input.purpose,
      resourceHashHex:rh.toString('hex'),
      expiresAt:expiresAt.toISOString(),
    };
  }

  async verify(input: {
    principal: Principal;
    challengeId: string;
    challenge: string;
    signatureBase64: string;
  }) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const q = await client.query(
        `SELECT c.*, b.public_key_spki
         FROM biometric_challenges c
         JOIN biometric_credentials b ON b.id=c.credential_id
         WHERE c.id=$1 FOR UPDATE`, [input.challengeId]
      );
      if (!q.rowCount) throw new Error('CHALLENGE_NOT_FOUND');
      const row = q.rows[0];
      if (row.user_id !== input.principal.userId || row.device_id !== input.principal.deviceId)
        throw new Error('CHALLENGE_BINDING_MISMATCH');
      if (row.consumed_at) throw new Error('CHALLENGE_ALREADY_USED');
      if (new Date(row.expires_at).getTime() < Date.now()) throw new Error('CHALLENGE_EXPIRED');
      if (!crypto.timingSafeEqual(row.challenge_hash,sha256(input.challenge)))
        throw new Error('CHALLENGE_MISMATCH');

      const payload = signingPayload({
        challengeId:row.id,
        challenge:input.challenge,
        purpose:row.purpose,
        resourceHashHex:Buffer.from(row.resource_hash).toString('hex'),
        userId:row.user_id,
        deviceId:row.device_id,
      });
      const publicKey = crypto.createPublicKey({key:row.public_key_spki,format:'der',type:'spki'});
      const ok = crypto.verify('sha256',payload,publicKey,Buffer.from(input.signatureBase64,'base64'));
      if (!ok) throw new Error('INVALID_BIOMETRIC_SIGNATURE');

      const grantId = randomUUID();
      const expiresAt = new Date(Date.now()+GRANT_TTL_MS);
      await client.query(`UPDATE biometric_challenges SET consumed_at=now() WHERE id=$1`,[row.id]);
      await client.query(
        `INSERT INTO biometric_grants
         (id,user_id,device_id,credential_id,purpose,resource_hash,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [grantId,row.user_id,row.device_id,row.credential_id,row.purpose,row.resource_hash,expiresAt]
      );
      await client.query(`UPDATE biometric_credentials SET last_used_at=now() WHERE id=$1`,[row.credential_id]);
      await client.query('COMMIT');
      await this.audit(input.principal,row.credential_id,'VERIFY',row.purpose,
        Buffer.from(row.resource_hash).toString('hex'),true);
      return {grantId,expiresAt:expiresAt.toISOString()};
    } catch(e) {
      await client.query('ROLLBACK');
      await this.audit(input.principal,undefined,'VERIFY',undefined,undefined,false,String(e));
      throw e;
    } finally { client.release(); }
  }

  async consumeGrant(input:{
    client?: PoolClient;
    principal: Principal;
    grantId:string;
    purpose:BiometricPurpose;
    resource:unknown;
  }) {
    const db = input.client ?? this.db;
    const rh = resourceHash(input.resource);
    const q = await db.query(
      `SELECT * FROM biometric_grants WHERE id=$1 FOR UPDATE`,[input.grantId]
    );
    if (!q.rowCount) throw new Error('GRANT_NOT_FOUND');
    const g=q.rows[0];
    if (g.user_id!==input.principal.userId || g.device_id!==input.principal.deviceId)
      throw new Error('GRANT_BINDING_MISMATCH');
    if (g.purpose!==input.purpose) throw new Error('GRANT_PURPOSE_MISMATCH');
    if (g.consumed_at) throw new Error('GRANT_ALREADY_USED');
    if (new Date(g.expires_at).getTime()<Date.now()) throw new Error('GRANT_EXPIRED');
    if (!crypto.timingSafeEqual(Buffer.from(g.resource_hash),rh)) throw new Error('GRANT_RESOURCE_MISMATCH');
    await db.query(`UPDATE biometric_grants SET consumed_at=now() WHERE id=$1`,[g.id]);
    return true;
  }

  async revoke(principal:Principal, credentialId:string) {
    await this.db.query(
      `UPDATE biometric_credentials SET revoked_at=now()
       WHERE id=$1 AND user_id=$2 AND device_id=$3 AND revoked_at IS NULL`,
      [credentialId,principal.userId,principal.deviceId]
    );
    await this.audit(principal,credentialId,'REVOKE',undefined,undefined,true);
  }

  private async audit(p:Principal,credentialId:string|undefined,event:string,purpose?:string,
                      rh?:string,success=true,reason?:string) {
    await this.db.query(
      `INSERT INTO biometric_audit_events
       (user_id,device_id,credential_id,event_type,purpose,resource_hash_hex,success,reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [p.userId,p.deviceId,credentialId??null,event,purpose??null,rh??null,success,reason?.slice(0,500)??null]
    ).catch(()=>{});
  }
}
