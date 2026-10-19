import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Database } from "../db/pool.js";
import { canonical, hashResource, p256Key, signingPayload, verifyP256, type BiometricPrincipal } from "../security/biometrics/canonical.js";
import { BiometricAuthorizationService } from "../security/biometrics/service.js";

const p: BiometricPrincipal = { userId: randomUUID(),deviceId: randomUUID(),installationId: randomUUID(),sessionId: randomUUID() };
const sha = (value: string) => createHash("sha256").update(value).digest();
function fixture(production = true) {
  const keys = generateKeyPairSync("ec",{ namedCurve: "prime256v1" });
  const spki = keys.publicKey.export({ format: "der",type: "spki" });
  const credential: Record<string,any> = { id: randomUUID(),...p,user_id: p.userId,device_id: p.deviceId,installation_id: p.installationId,state: "ACTIVE",security_epoch: 1,public_key_spki: spki,algorithm: "P256_SHA256",key_alias: "linqa.bio.test",attestation_status: "VERIFIED",revoked_at: null };
  const state: Record<string,any> = { security_epoch: 1,audit_head: null,recovery_in_progress: false };
  const challenges = new Map<string,Record<string,any>>(), grants = new Map<string,Record<string,any>>(), enrollments = new Map<string,Record<string,any>>();
  const audit: Record<string,any>[] = [], sqlCalls: string[] = [];
  const snapshot = { quote_snapshot: '{"amount":"100","fee":"2","quoteVersion":1}',recipient_snapshot: '{"id":"recipient","payout":"original"}',funding_snapshot: '{"id":"funding"}' };
  let trusted = true,riskDenied = false;
  const payment = { id: randomUUID(),transfer_id: randomUUID(),expected_transaction_hash: "a".repeat(64),challenge_nonce: "nonce",biometric_quote_id: randomUUID(),biometric_payment_method_id: randomUUID() };
  const result = (rows: any[] = []) => ({ rows,rowCount: rows.length });
  const query = async (sql: string, args: any[] = []): Promise<any> => {
    sqlCalls.push(sql);
    if (["BEGIN","COMMIT","ROLLBACK"].includes(sql)) return result();
    if (sql.startsWith("INSERT INTO biometric_security_state")) return result();
    if (sql.startsWith("SELECT * FROM biometric_security_state")) return result([state]);
    if (sql.startsWith("SELECT audit_head")) return result([{ audit_head: state.audit_head }]);
    if (sql.startsWith("SELECT d.platform")) return result(trusted ? [{ platform: "ANDROID" }] : []);
    if (sql.startsWith("SELECT c.* FROM biometric_credentials")) return result(credential.state === "ACTIVE" && !credential.revoked_at && (!args[3] || credential.id === args[3]) ? [credential] : []);
    if (sql.startsWith("SELECT id,key_alias")) return result([credential]);
    if (sql.startsWith("INSERT INTO biometric_audit_events")) { audit.push({ id: args[0],details: args[3],previous_hash: args[4],event_hash: args[5] }); return result(); }
    if (sql.startsWith("UPDATE biometric_security_state SET audit_head")) { state.audit_head = args[1]; return result(); }
    if (sql.startsWith("INSERT INTO biometric_challenges")) { const [id,user_id,device_id,installation_id,session_id,credential_id,purpose,resource_hash,challenge_hash,security_epoch,expires_at] = args; challenges.set(id,{ id,user_id,device_id,installation_id,session_id,credential_id,purpose,resource_hash,challenge_hash,security_epoch,expires_at,resource_version: 1 }); return result(); }
    if (sql.startsWith("SELECT * FROM biometric_challenges")) return result(challenges.has(args[0]) ? [challenges.get(args[0])] : []);
    if (sql.startsWith("UPDATE biometric_challenges SET consumed_at")) { challenges.get(args[0])!.consumed_at = new Date(); return result(); }
    if (sql.startsWith("INSERT INTO biometric_grants")) { const [id,user_id,device_id,installation_id,session_id,credential_id,purpose,resource_hash,resource_version,security_epoch,expires_at] = args; grants.set(id,{ id,user_id,device_id,installation_id,session_id,credential_id,purpose,resource_hash,resource_version,security_epoch,expires_at }); return result(); }
    if (sql.startsWith("SELECT * FROM biometric_grants")) return result(grants.has(args[0]) ? [grants.get(args[0])] : []);
    if (sql.startsWith("UPDATE biometric_grants SET consumed_at")) { grants.get(args[0])!.consumed_at = new Date(); return result(); }
    if (sql.startsWith("UPDATE biometric_credentials SET last_used_at")) return result();
    if (sql.startsWith("INSERT INTO biometric_enrollment_requests")) { const [id,user_id,device_id,installation_id,session_id,nonce_hash,security_epoch,expires_at] = args; enrollments.set(id,{ id,user_id,device_id,installation_id,session_id,nonce_hash,security_epoch,expires_at }); return result(); }
    if (sql.startsWith("SELECT * FROM biometric_enrollment_requests")) return result([enrollments.get(args[0])]);
    if (sql.startsWith("SELECT * FROM linqasend_transaction_challenges")) return result(args[0] === payment.id ? [payment] : []);
    if (sql.startsWith("SELECT 1 FROM linqasend_trusted_payment")) return result(riskDenied ? [{ "?column?": 1 }] : []);
    if (sql.startsWith("SELECT to_jsonb(q)")) return result([snapshot]);
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const client = { query,release: () => undefined };
  const db = { query,connect: async () => client } as unknown as Database;
  const bio = new BiometricAuthorizationService(db,production);
  return { bio,keys,credential,state,challenges,grants,enrollments,audit,sqlCalls,db,payment,snapshot,setTrusted: (value: boolean) => { trusted = value; },setRisk: (value: boolean) => { riskDenied = value; } };
}

async function grant(f: ReturnType<typeof fixture>) {
  const challenge = await f.bio.challenge(p,"VAULT_UNLOCK",{});
  const signatureBase64 = sign("sha256",Buffer.from(challenge.payloadBase64,"base64"),f.keys.privateKey).toString("base64");
  return { challenge,signatureBase64,...await f.bio.verify(p,{ challengeId: challenge.challengeId,challenge: challenge.challenge,signatureBase64 }) };
}
describe("biometric v5 authorization",() => {
  it("verifies P-256 DER signatures and rejects wrong curves and modified payloads",() => {
    const f = fixture(), payload = Buffer.from("proof"),signature = sign("sha256",payload,f.keys.privateKey);
    expect(verifyP256(f.credential.public_key_spki,payload,signature)).toBe(true);
    expect(verifyP256(f.credential.public_key_spki,Buffer.from("different"),signature)).toBe(false);
    const bad = generateKeyPairSync("ec",{ namedCurve: "secp384r1" }).publicKey.export({ type: "spki",format: "der" });
    expect(() => p256Key(bad)).toThrow("INVALID_BIOMETRIC_KEY");
  });
  it("canonicalizes keys and rejects undefined, fractional and unsafe values",() => {
    expect(canonical({ z: 2,a: 1 })).toBe(canonical({ a: 1,z: 2 }));
    for (const invalid of [undefined,{ value: undefined },1.5,Number.MAX_SAFE_INTEGER+1]) expect(() => canonical(invalid)).toThrow();
  });
  it("binds the signed payload to the authenticated installation and session",() => {
    const value = { ...p,challengeId: "challenge",challenge: "nonce",purpose: "VAULT_UNLOCK" as const,resourceHashHex: "a".repeat(64),securityEpoch: 1 };
    expect(signingPayload(value)).not.toEqual(signingPayload({ ...value,sessionId: randomUUID() }));
    expect(signingPayload(value)).not.toEqual(signingPayload({ ...value,installationId: randomUUID() }));
  });
  it("rejects replayed challenges and grants",async () => {
    const f = fixture(), issued = await grant(f);
    await expect(f.bio.verify(p,{ challengeId: issued.challenge.challengeId,challenge: issued.challenge.challenge,signatureBase64: issued.signatureBase64 })).rejects.toThrow("BIOMETRIC_ALREADY_USED");
    await f.bio.transaction(client => f.bio.consume(client,p,issued.grantId,"VAULT_UNLOCK",{ userId: p.userId,action: "UNLOCK_PRIVATE_VAULT" }));
    await expect(f.bio.transaction(client => f.bio.consume(client,p,issued.grantId,"VAULT_UNLOCK",{ userId: p.userId,action: "UNLOCK_PRIVATE_VAULT" }))).rejects.toThrow("BIOMETRIC_ALREADY_USED");
  });
  it.each(["userId","deviceId","installationId","sessionId"] as const)("rejects a changed %s",async key => {
    const f = fixture(), issued = await grant(f);
    await expect(f.bio.transaction(client => f.bio.consume(client,{ ...p,[key]: randomUUID() },issued.grantId,"VAULT_UNLOCK",{}))).rejects.toThrow("BIOMETRIC_BINDING_MISMATCH");
  });
  it("rejects expiry and stale recovery epochs",async () => {
    const f = fixture(), issued = await grant(f);
    f.grants.get(issued.grantId)!.expires_at = new Date(0);
    await expect(f.bio.transaction(client => f.bio.consume(client,p,issued.grantId,"VAULT_UNLOCK",{}))).rejects.toThrow("BIOMETRIC_EXPIRED");
    f.grants.get(issued.grantId)!.expires_at = new Date(Date.now()+90_000); f.state.security_epoch++;
    await expect(f.bio.transaction(client => f.bio.consume(client,p,issued.grantId,"VAULT_UNLOCK",{}))).rejects.toThrow("BIOMETRIC_SECURITY_EPOCH_STALE");
  });
  it("rejects revoked credentials and revoked device/session trust after proof",async () => {
    const f = fixture(), issued = await grant(f); f.credential.state = "REVOKED";
    await expect(f.bio.transaction(client => f.bio.consume(client,p,issued.grantId,"VAULT_UNLOCK",{}))).rejects.toThrow("BIOMETRIC_NOT_ENROLLED_OR_REVOKED");
    f.setTrusted(false);
    await expect(f.bio.challenge(p,"VAULT_UNLOCK",{})).rejects.toThrow("BIOMETRIC_DEVICE_OR_SESSION_NOT_TRUSTED");
  });
  it("rejects a Vault grant for payment and rejects resource/version mutation",async () => {
    const f = fixture(), issued = await grant(f);
    await expect(f.bio.transaction(client => f.bio.consume(client,p,issued.grantId,"SEND_TRANSFER_AUTHORIZE",{}))).rejects.toThrow("BIOMETRIC_PURPOSE_MISMATCH");
    await expect(f.bio.transaction(client => f.bio.consume(client,p,issued.grantId,"VAULT_UNLOCK",{ action: "DELETE" }))).rejects.toThrow("BIOMETRIC_RESOURCE_CHANGED");
    await expect(f.bio.transaction(client => f.bio.consume(client,p,issued.grantId,"VAULT_UNLOCK",{ userId: p.userId,action: "UNLOCK_PRIVATE_VAULT" },2))).rejects.toThrow("BIOMETRIC_RESOURCE_CHANGED");
  });
  it("rejects invalid signatures without issuing a grant",async () => {
    const f = fixture(), challenge = await f.bio.challenge(p,"VAULT_UNLOCK",{});
    await expect(f.bio.verify(p,{ challengeId: challenge.challengeId,challenge: challenge.challenge,signatureBase64: Buffer.alloc(72).toString("base64") })).rejects.toThrow("BIOMETRIC_SIGNATURE_INVALID");
    expect(f.grants.size).toBe(0);
  });
  it("requires production attestation after validating enrollment proof",async () => {
    const f = fixture(), challenge = await f.bio.enrollmentChallenge(p), publicKeySpkiBase64 = f.credential.public_key_spki.toString("base64"),keyAlias = "linqa.bio.enrollment";
    const payload = Buffer.from(canonical({ v: 5,action: "ENROLL",enrollmentId: challenge.enrollmentId,nonce: challenge.nonce,...p,securityEpoch: 1,publicKeySpkiBase64,keyAlias }));
    await expect(f.bio.enroll(p,{ enrollmentId: challenge.enrollmentId,nonce: challenge.nonce,platform: "ANDROID",keyAlias,publicKeySpkiBase64,signatureBase64: sign("sha256",payload,f.keys.privateKey).toString("base64"),attestation: {} })).rejects.toThrow("BIOMETRIC_ATTESTATION_REQUIRED");
    expect(f.sqlCalls.some(sql => sql.startsWith("INSERT INTO biometric_credentials"))).toBe(false);
  });
  it.each(["quote_snapshot","recipient_snapshot","funding_snapshot"] as const)("binds payment proof to the current %s",async key => {
    const f = fixture(), original = await f.bio.transaction(client => f.bio.resource(client,p,"SEND_TRANSFER_AUTHORIZE",{ paymentChallengeId: f.payment.id }));
    f.snapshot[key] += "changed";
    const changed = await f.bio.transaction(client => f.bio.resource(client,p,"SEND_TRANSFER_AUTHORIZE",{ paymentChallengeId: f.payment.id }));
    expect(hashResource(original)).not.toEqual(hashResource(changed));
  });
  it("lets risk denial override a valid enrolled credential",async () => {
    const f = fixture(); f.setRisk(true);
    await expect(f.bio.challenge(p,"SEND_TRANSFER_AUTHORIZE",{ paymentChallengeId: f.payment.id })).rejects.toThrow("BIOMETRIC_PAYMENT_SECURITY_DENIED");
  });
  it("rejects unconfigured purposes instead of accepting an arbitrary resource",async () => {
    const f = fixture(); await expect(f.bio.challenge(p,"SEND_CHANGE_SECURITY",{})).rejects.toThrow("BIOMETRIC_PURPOSE_NOT_CONFIGURED");
  });
  it("requires a server-owned withdrawal reference before issuing a cash-out challenge",async()=>{
    const f=fixture();await expect(f.bio.challenge(p,"SEND_CASHOUT_AUTHORIZE",{})).rejects.toThrow("BIOMETRIC_WITHDRAWAL_CHALLENGE_INVALID");
  });
  it("keeps successful security evidence in a hash chain",async () => {
    const f = fixture(); await grant(f); const first = f.audit[0]!;
    expect(first.event_hash).toEqual(createHash("sha256").update(Buffer.concat([Buffer.alloc(32),Buffer.from(canonical(first.details))])).digest());
    expect(f.state.audit_head).toEqual(first.event_hash);
    expect(f.sqlCalls).toContain("COMMIT");
  });
});
