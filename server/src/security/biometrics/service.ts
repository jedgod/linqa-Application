import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import type { Database } from "../../db/pool.js";
import { canonical, hashResource, p256Key, signingPayload, verifyP256, type BiometricPrincipal, type BiometricPurpose } from "./canonical.js";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest();
const equal = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
export type AttestationInput = { principal: BiometricPrincipal; platform: "IOS" | "ANDROID"; publicKeySpkiBase64: string; nonce: string; evidence: unknown };
export interface BiometricAttestationVerifier { verify(input: AttestationInput): Promise<{ verified: boolean; provider: string }> }
export const unavailableAttestation: BiometricAttestationVerifier = { verify: async () => ({ verified: false, provider: "NOT_CONFIGURED" }) };

/** v5 integration with Linqa principals and transactions; no biometric templates leave the OS. */
export class BiometricAuthorizationService {
  constructor(private readonly db: Database, private readonly production: boolean, private readonly attestation: BiometricAttestationVerifier = unavailableAttestation) {}

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try { await client.query("BEGIN"); const value = await work(client); await client.query("COMMIT"); return value; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async guard(client: PoolClient, principal: BiometricPrincipal) {
    // Lock ordering is always security state -> trusted principal -> credential -> challenge/grant.
    // Recovery/revocation serializes against verification and consumption for this account.
    await client.query(`INSERT INTO biometric_security_state(user_id) VALUES($1) ON CONFLICT DO NOTHING`, [principal.userId]);
    const state = (await client.query(`SELECT * FROM biometric_security_state WHERE user_id=$1 FOR UPDATE`, [principal.userId])).rows[0];
    if (!state || state.recovery_in_progress || (state.locked_until && new Date(state.locked_until).getTime() > Date.now())) throw new Error("BIOMETRIC_SECURITY_LOCKED");
    const trusted = await client.query(`SELECT d.platform FROM devices d
      JOIN users u ON u.id=d.user_id AND u.status='ACTIVE'
      JOIN auth_sessions s ON s.id=$3 AND s.user_id=d.user_id AND s.device_id=d.id AND s.revoked_at IS NULL AND s.expires_at>now()
      JOIN trusted_installation_devices_v3 t ON t.device_id=d.id AND t.user_id=d.user_id AND t.installation_id=$4 AND t.trust_state='TRUSTED' AND t.revoked_at IS NULL
      JOIN device_installations_v2 i ON i.id=t.installation_id AND i.trust_state='TRUSTED'
      JOIN installation_accounts_v2 a ON a.installation_id=i.id AND a.user_id=d.user_id AND a.state='ACTIVE'
      WHERE d.id=$2 AND d.user_id=$1 AND d.status='ACTIVE' AND d.revoked_at IS NULL
      FOR SHARE OF d,u,s,t,i,a`, [principal.userId, principal.deviceId, principal.sessionId, principal.installationId]);
    if (!trusted.rows[0]) throw new Error("BIOMETRIC_DEVICE_OR_SESSION_NOT_TRUSTED");
    return { epoch: Number(state.security_epoch), platform: trusted.rows[0].platform as string, head: state.audit_head as Buffer | null };
  }

  private async audit(client: PoolClient, p: BiometricPrincipal, event: string, details: Record<string, unknown>) {
    const state = (await client.query(`SELECT audit_head FROM biometric_security_state WHERE user_id=$1`, [p.userId])).rows[0];
    const id = randomUUID(), payload = { id, userId: p.userId, deviceId: p.deviceId, sessionId: p.sessionId, event, ...details };
    const previous = state?.audit_head as Buffer | null;
    const digest = sha(Buffer.concat([previous ?? Buffer.alloc(32), Buffer.from(canonical(payload))]));
    await client.query(`INSERT INTO biometric_audit_events(id,user_id,event_type,details,previous_hash,event_hash) VALUES($1,$2,$3,$4,$5,$6)`, [id, p.userId, event, payload, previous, digest]);
    await client.query(`UPDATE biometric_security_state SET audit_head=$2,updated_at=now() WHERE user_id=$1`, [p.userId, digest]);
  }

  private async credential(client: PoolClient, p: BiometricPrincipal, epoch: number, id?: string) {
    const row = (await client.query(`SELECT c.* FROM biometric_credentials c WHERE c.user_id=$1 AND c.device_id=$2 AND c.installation_id=$3
      AND c.state='ACTIVE' AND c.revoked_at IS NULL AND ($4::uuid IS NULL OR c.id=$4)
      AND NOT EXISTS (SELECT 1 FROM linqasend_security_change_events_v4 e WHERE e.user_id=c.user_id AND e.event_type='ACCOUNT_RECOVERY_COMPLETED' AND e.event_at>c.enrolled_at)
      ORDER BY c.enrolled_at DESC LIMIT 1 FOR UPDATE`, [p.userId, p.deviceId, p.installationId, id ?? null])).rows[0];
    if (!row || Number(row.security_epoch) !== epoch) throw new Error("BIOMETRIC_NOT_ENROLLED_OR_REVOKED");
    if (row.algorithm !== "P256_SHA256" || (this.production && row.attestation_status !== "VERIFIED")) throw new Error("BIOMETRIC_ATTESTATION_REQUIRED");
    return row;
  }

  async status(p: BiometricPrincipal) {
    return this.transaction(async client => {
      const { epoch } = await this.guard(client, p);
      const rows = (await client.query(`SELECT id,key_alias,attestation_status,security_epoch FROM biometric_credentials c WHERE user_id=$1 AND device_id=$2 AND installation_id=$3 AND state='ACTIVE' AND revoked_at IS NULL AND NOT EXISTS (SELECT 1 FROM linqasend_security_change_events_v4 e WHERE e.user_id=c.user_id AND e.event_type='ACCOUNT_RECOVERY_COMPLETED' AND e.event_at>c.enrolled_at) ORDER BY enrolled_at DESC`, [p.userId, p.deviceId, p.installationId])).rows;
      const current = rows.find(row => Number(row.security_epoch) === epoch && (!this.production || row.attestation_status === "VERIFIED"));
      return { enrolled: !!current, credentialId: current?.id ?? null, keyAlias: current?.key_alias ?? null, attestation: current?.attestation_status ?? "NOT_ENROLLED", productionAttestationRequired: this.production };
    });
  }

  async enrollmentChallenge(p: BiometricPrincipal) {
    return this.transaction(async client => {
      const { epoch } = await this.guard(client, p);
      const enrollmentId = randomUUID(), nonce = randomBytes(32).toString("base64url"), expiresAt = new Date(Date.now() + 90_000);
      await client.query(`INSERT INTO biometric_enrollment_requests(id,user_id,device_id,installation_id,session_id,nonce_hash,security_epoch,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [enrollmentId,p.userId,p.deviceId,p.installationId,p.sessionId,sha(nonce),epoch,expiresAt]);
      return { enrollmentId, nonce, principal: p, securityEpoch: epoch, expiresAt: expiresAt.toISOString() };
    });
  }

  async enroll(p: BiometricPrincipal, input: { enrollmentId: string; nonce: string; platform: "IOS" | "ANDROID"; keyAlias: string; publicKeySpkiBase64: string; signatureBase64: string; attestation: unknown }) {
    const spki = Buffer.from(input.publicKeySpkiBase64, "base64"); p256Key(spki);
    return this.transaction(async client => {
      const { epoch, platform } = await this.guard(client, p);
      if (platform !== input.platform) throw new Error("BIOMETRIC_PLATFORM_MISMATCH");
      const pending = (await client.query(`SELECT * FROM biometric_enrollment_requests WHERE id=$1 FOR UPDATE`, [input.enrollmentId])).rows[0];
      this.assertBound(p, pending, epoch);
      if (!equal(Buffer.from(pending.nonce_hash), sha(input.nonce))) throw new Error("BIOMETRIC_ENROLLMENT_NONCE_MISMATCH");
      const payload = Buffer.from(canonical({ v: 5, action: "ENROLL", enrollmentId: input.enrollmentId, nonce: input.nonce, ...p, securityEpoch: epoch, publicKeySpkiBase64: input.publicKeySpkiBase64, keyAlias: input.keyAlias }));
      if (!verifyP256(spki, payload, Buffer.from(input.signatureBase64, "base64"))) throw new Error("BIOMETRIC_ENROLLMENT_PROOF_INVALID");
      const attested = await this.attestation.verify({ principal: p, platform: input.platform, publicKeySpkiBase64: input.publicKeySpkiBase64, nonce: input.nonce, evidence: input.attestation });
      if (this.production && !attested.verified) throw new Error("BIOMETRIC_ATTESTATION_REQUIRED");
      const id = randomUUID();
      // Replacing the current key invalidates its outstanding grants and Vault sessions.
      await client.query(`UPDATE biometric_credentials SET state='REVOKED',revoked_at=now() WHERE user_id=$1 AND installation_id=$2 AND device_id=$3 AND state='ACTIVE'`, [p.userId,p.installationId,p.deviceId]);
      await client.query(`INSERT INTO biometric_credentials(id,user_id,device_id,installation_id,platform,public_key_spki,key_alias,security_epoch,attestation_status,attestation_provider) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id,p.userId,p.deviceId,p.installationId,input.platform,spki,input.keyAlias,epoch,attested.verified ? "VERIFIED" : "NOT_SUPPORTED",attested.provider]);
      await client.query(`UPDATE biometric_enrollment_requests SET consumed_at=now() WHERE id=$1`, [input.enrollmentId]);
      await this.audit(client,p,"ENROLL",{ credentialId: id, attestation: attested.verified ? "VERIFIED" : "NOT_SUPPORTED" });
      return { credentialId: id, keyAlias: input.keyAlias, attestation: attested.verified ? "VERIFIED" : "NOT_SUPPORTED" };
    });
  }

  private assertBound(p: BiometricPrincipal, row: Record<string, any> | undefined, epoch: number) {
    if (!row || row.user_id !== p.userId || row.device_id !== p.deviceId || row.installation_id !== p.installationId || row.session_id !== p.sessionId) throw new Error("BIOMETRIC_BINDING_MISMATCH");
    if (row.consumed_at) throw new Error("BIOMETRIC_ALREADY_USED");
    if (!(new Date(row.expires_at).getTime() > Date.now())) throw new Error("BIOMETRIC_EXPIRED");
    if (Number(row.security_epoch) !== epoch) throw new Error("BIOMETRIC_SECURITY_EPOCH_STALE");
  }

  async resource(client: PoolClient, p: BiometricPrincipal, purpose: BiometricPurpose, reference: { paymentChallengeId?: string; itemId?: string }, consumedPayment = false) {
    if (purpose === "VAULT_UNLOCK") return { userId: p.userId, action: "UNLOCK_PRIVATE_VAULT" };
    if (purpose === "VAULT_PRIVATE_OPEN") {
      const item = (await client.query(`SELECT id,version,item_type FROM vault_items WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR SHARE`, [reference.itemId,p.userId])).rows[0];
      if (!item || !["IDENTITY", "RECOVERY"].includes(item.item_type)) throw new Error("PRIVATE_VAULT_ITEM_NOT_FOUND");
      return { userId: p.userId, itemId: item.id, version: item.version, action: "OPEN_PRIVATE_ITEM" };
    }
    if (purpose === "SEND_TRANSFER_AUTHORIZE") {
      const payment = (await client.query(`SELECT * FROM linqasend_transaction_challenges_v4 WHERE id=$1 AND user_id=$2 AND device_id=$3 AND installation_id=$4 AND ($5::boolean OR consumed_at IS NULL) AND expires_at>now() FOR UPDATE`, [reference.paymentChallengeId,p.userId,p.deviceId,p.installationId,consumedPayment])).rows[0];
      if (!payment) throw new Error("PAYMENT_CHALLENGE_INVALID");
      const risk = await client.query(`SELECT 1 FROM linqasend_trusted_payment_devices_v4 WHERE user_id=$1 AND installation_id=$2 AND device_id=$3 AND trust_state IN ('RISKY','REVOKED') UNION ALL SELECT 1 FROM linqasend_security_change_events_v4 WHERE user_id=$1 AND event_at>now()-interval '24 hours' LIMIT 1`, [p.userId,p.installationId,p.deviceId]);
      if (risk.rows.length) throw new Error("BIOMETRIC_PAYMENT_SECURITY_DENIED");
      const snapshot = (await client.query(`SELECT to_jsonb(q)::text AS quote_snapshot,to_jsonb(r)::text AS recipient_snapshot,to_jsonb(m)::text AS funding_snapshot
        FROM linqasend_quotes q JOIN linqasend_recipients r ON r.id=q.recipient_id AND r.owner_user_id=q.user_id
        JOIN linqasend_payment_methods m ON m.id=$3 AND m.user_id=q.user_id AND m.deleted_at IS NULL
        WHERE q.id=$1 AND q.user_id=$2 AND q.status='ACTIVE' AND q.expires_at>now() FOR SHARE OF q,r,m`,[payment.biometric_quote_id,p.userId,payment.biometric_payment_method_id])).rows[0];
      if (!snapshot) throw new Error("BIOMETRIC_PAYMENT_SNAPSHOT_UNAVAILABLE");
      return { paymentChallengeId: payment.id, transferId: payment.transfer_id, transactionHash: payment.expected_transaction_hash, nonce: payment.challenge_nonce, action: "AUTHORIZE_TRANSFER",quoteSnapshotHash: sha(snapshot.quote_snapshot).toString("hex"),recipientSnapshotHash: sha(snapshot.recipient_snapshot).toString("hex"),fundingSnapshotHash: sha(snapshot.funding_snapshot).toString("hex") };
    }
    // A listed pack purpose is not sufficient: an authoritative resource adapter is mandatory.
    throw new Error("BIOMETRIC_PURPOSE_NOT_CONFIGURED");
  }

  async challenge(p: BiometricPrincipal, purpose: BiometricPurpose, reference: { paymentChallengeId?: string; itemId?: string }) {
    return this.transaction(async client => {
      const { epoch } = await this.guard(client,p), credential = await this.credential(client,p,epoch);
      const resource = await this.resource(client,p,purpose,reference), resourceHashHex = hashResource(resource).toString("hex");
      const challengeId = randomUUID(), challenge = randomBytes(32).toString("base64url"), expiresAt = new Date(Date.now()+90_000);
      await client.query(`INSERT INTO biometric_challenges(id,user_id,device_id,installation_id,session_id,credential_id,purpose,resource_hash,challenge_hash,security_epoch,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [challengeId,p.userId,p.deviceId,p.installationId,p.sessionId,credential.id,purpose,Buffer.from(resourceHashHex,"hex"),sha(challenge),epoch,expiresAt]);
      return { challengeId, challenge, purpose, resourceHashHex, securityEpoch: epoch, expiresAt: expiresAt.toISOString(), keyAlias: credential.key_alias, payloadBase64: signingPayload({ ...p,challengeId,challenge,purpose,resourceHashHex,securityEpoch: epoch }).toString("base64") };
    });
  }

  async verify(p: BiometricPrincipal, input: { challengeId: string; challenge: string; signatureBase64: string }) {
    return this.transaction(async client => {
      const { epoch } = await this.guard(client,p);
      const row = (await client.query(`SELECT * FROM biometric_challenges WHERE id=$1 FOR UPDATE`, [input.challengeId])).rows[0];
      this.assertBound(p,row,epoch);
      const credential = await this.credential(client,p,epoch,row.credential_id);
      if (!equal(Buffer.from(row.challenge_hash),sha(input.challenge))) throw new Error("BIOMETRIC_CHALLENGE_MISMATCH");
      const payload = signingPayload({ ...p,challengeId: row.id,challenge: input.challenge,purpose: row.purpose,resourceHashHex: Buffer.from(row.resource_hash).toString("hex"),securityEpoch: epoch });
      if (!verifyP256(Buffer.from(credential.public_key_spki),payload,Buffer.from(input.signatureBase64,"base64"))) throw new Error("BIOMETRIC_SIGNATURE_INVALID");
      const grantId = randomUUID(), expiresAt = new Date(Date.now()+90_000);
      await client.query(`UPDATE biometric_challenges SET consumed_at=now() WHERE id=$1`,[row.id]);
      await client.query(`INSERT INTO biometric_grants(id,user_id,device_id,installation_id,session_id,credential_id,purpose,resource_hash,resource_version,security_epoch,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[grantId,p.userId,p.deviceId,p.installationId,p.sessionId,credential.id,row.purpose,row.resource_hash,row.resource_version,epoch,expiresAt]);
      await client.query(`UPDATE biometric_credentials SET last_used_at=now() WHERE id=$1`,[credential.id]);
      await this.audit(client,p,"VERIFY",{ credentialId: credential.id, grantId, purpose: row.purpose });
      return { grantId, expiresAt: expiresAt.toISOString() };
    });
  }

  async consume(client: PoolClient,p: BiometricPrincipal,grantId: string,purpose: BiometricPurpose,resource: unknown,resourceVersion=1) {
    const { epoch } = await this.guard(client,p);
    const grant = (await client.query(`SELECT * FROM biometric_grants WHERE id=$1 FOR UPDATE`,[grantId])).rows[0];
    this.assertBound(p,grant,epoch);
    await this.credential(client,p,epoch,grant.credential_id);
    if (grant.purpose !== purpose) throw new Error("BIOMETRIC_PURPOSE_MISMATCH");
    if (Number(grant.resource_version) !== resourceVersion || !equal(Buffer.from(grant.resource_hash),hashResource(resource))) throw new Error("BIOMETRIC_RESOURCE_CHANGED");
    await client.query(`UPDATE biometric_grants SET consumed_at=now() WHERE id=$1`,[grant.id]);
    await this.audit(client,p,"CONSUME",{ grantId, purpose });
    return grant;
  }

  async unlockVault(p: BiometricPrincipal,grantId: string) {
    return this.transaction(async client => {
      const resource = await this.resource(client,p,"VAULT_UNLOCK",{});
      const grant = await this.consume(client,p,grantId,"VAULT_UNLOCK",resource);
      const token = randomBytes(32).toString("base64url"), expiresAt = new Date(Date.now()+300_000);
      await client.query(`INSERT INTO biometric_vault_sessions(token_hash,user_id,device_id,installation_id,session_id,credential_id,security_epoch,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[sha(token),p.userId,p.deviceId,p.installationId,p.sessionId,grant.credential_id,grant.security_epoch,expiresAt]);
      return { token,expiresAt: expiresAt.toISOString() };
    });
  }

  async assertVaultSession(p: BiometricPrincipal,token: string) {
    return this.transaction(async client => {
      const { epoch } = await this.guard(client,p);
      const row = (await client.query(`SELECT * FROM biometric_vault_sessions WHERE token_hash=$1 AND revoked_at IS NULL`,[sha(token)])).rows[0];
      this.assertBound(p,row,epoch); await this.credential(client,p,epoch,row.credential_id);
    });
  }
  async lockVault(p: BiometricPrincipal,token: string) { await this.db.query(`UPDATE biometric_vault_sessions SET revoked_at=now() WHERE token_hash=$1 AND user_id=$2 AND device_id=$3 AND session_id=$4`,[sha(token),p.userId,p.deviceId,p.sessionId]); }

  async consumePaymentAuthorization(p: BiometricPrincipal,input: { authorizationId: string; transferId: string; transactionHash: string }) {
    return this.transaction(async client => {
      const { epoch } = await this.guard(client,p);
      const row = (await client.query(`SELECT * FROM linqasend_transaction_authorizations_v4 WHERE id=$1 AND user_id=$2 FOR UPDATE`,[input.authorizationId,p.userId])).rows[0];
      if (!row || row.auth_method !== "DEVICE_BIOMETRIC" || row.device_binding_key_id !== p.deviceId || row.biometric_session_id !== p.sessionId || row.biometric_installation_id !== p.installationId || row.transfer_id !== input.transferId || row.transaction_hash !== input.transactionHash || row.consumed_at || !(new Date(row.expires_at).getTime()>Date.now()) || Number(row.biometric_security_epoch) !== epoch) throw new Error("BIOMETRIC_PAYMENT_AUTHORIZATION_INVALID");
      await this.credential(client,p,epoch,row.biometric_credential_id);
      const resource = await this.resource(client,p,"SEND_TRANSFER_AUTHORIZE",{ paymentChallengeId: row.biometric_payment_challenge_id },true);
      if (!row.biometric_resource_hash || !equal(Buffer.from(row.biometric_resource_hash),hashResource(resource))) throw new Error("BIOMETRIC_PAYMENT_SNAPSHOT_CHANGED");
      await client.query(`UPDATE linqasend_transaction_authorizations_v4 SET consumed_at=now() WHERE id=$1`,[row.id]);
      await this.audit(client,p,"PAYMENT_AUTHORIZATION_CONSUMED",{ authorizationId: row.id,transferId: input.transferId });
    });
  }

  async revoke(p: BiometricPrincipal,credentialId?: string) {
    return this.transaction(async client => {
      await this.guard(client,p);
      await client.query(`UPDATE biometric_credentials SET state='REVOKED',revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1 AND ($2::uuid IS NULL OR id=$2)`,[p.userId,credentialId ?? null]);
      if (!credentialId) await client.query(`UPDATE biometric_security_state SET security_epoch=security_epoch+1,updated_at=now() WHERE user_id=$1`,[p.userId]);
      await this.audit(client,p,credentialId ? "REVOKE" : "REVOKE_ALL",{ credentialId: credentialId ?? null });
    });
  }
}
