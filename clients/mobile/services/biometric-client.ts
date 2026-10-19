import type { BiometricSigningModule } from "../modules/linqa-biometric";
export type BiometricPurpose = "VAULT_UNLOCK" | "VAULT_PRIVATE_OPEN" | "SEND_TRANSFER_AUTHORIZE" | "SEND_CASHOUT_AUTHORIZE" | "SEND_WALLET_AUTHORIZE";
export type BiometricStatus = { enrolled: boolean; credentialId: string | null; keyAlias: string | null; attestation: string; productionAttestationRequired: boolean };
type Context = { token: string; principal: { userId: string; deviceId: string; sessionId: string; installationId: string } };
export type VaultUnlockSession = { token: string; expiresAt: string };
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string,unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const encoded = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const nonceBase64 = (value: string) => value.replace(/-/g,"+").replace(/_/g,"/").padEnd(44,"=");

/** Server-authorized signatures; a successful local prompt alone never returns a grant. */
export class BiometricClient {
  constructor(private readonly baseUrl: string,private readonly token: () => Promise<string>,private readonly installation: () => Promise<string | null>,private readonly native: BiometricSigningModule | null,private readonly isCurrent: () => boolean = () => true) {}
  private current() { if (!this.isCurrent()) throw new Error("Account changed. Reopen this screen to continue."); }
  private async context(): Promise<Context> {
    this.current(); const token = await this.token(), installationId = await this.installation(); this.current();
    const part = token.split(".")[1]; if (!part || !installationId) throw new Error("Sign in on a registered device to use biometrics.");
    const payload = JSON.parse(atob(part.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(part.length/4)*4,"="))) as Record<string,unknown>;
    const { user_id: userId,device_id: deviceId,sid: sessionId } = payload;
    if (![userId,deviceId,sessionId,installationId].every(value => typeof value === "string" && /^[a-f\d-]{36}$/i.test(value))) throw new Error("Device-bound authentication is required.");
    return { token,principal: { userId: userId as string,deviceId: deviceId as string,sessionId: sessionId as string,installationId } };
  }
  private async request<T>(context: Context,path: string,init: RequestInit = {}): Promise<T> {
    this.current();
    const response = await fetch(`${this.baseUrl}${path}`,{ ...init,headers: { authorization: `Bearer ${context.token}`,"x-installation-id": context.principal.installationId,...(init.body ? { "content-type": "application/json" } : {}),...init.headers } });
    const value = await response.json().catch(() => ({})); this.current();
    if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "Biometric authorization failed.");
    return value as T;
  }
  async available() { return this.native ? this.native.isAvailable().catch(() => ({ available: false,strong: false,type: "NONE" as const })) : { available: false,strong: false,type: "NONE" as const }; }
  async status() { return this.request<BiometricStatus>(await this.context(),"/v1/security/biometrics/status"); }
  async enroll() {
    if (!this.native || !(await this.available()).strong) throw new Error("Strong biometric signing is unavailable. Rebuild the app or enroll device biometrics.");
    const context = await this.context();
    const challenge = await this.request<{ enrollmentId: string; nonce: string; principal: Context["principal"]; securityEpoch: number }>(context,"/v1/security/biometrics/enroll/challenge",{ method: "POST" });
    if (stable(context.principal) !== stable(challenge.principal)) throw new Error("Biometric enrollment identity mismatch.");
    const keyAlias = `linqa.bio.${context.principal.userId}.${challenge.enrollmentId}`;
    const key = await this.native.createSigningKey(keyAlias,nonceBase64(challenge.nonce));
    try {
      this.current();
      const payload = stable({ v: 5,action: "ENROLL",enrollmentId: challenge.enrollmentId,nonce: challenge.nonce,...context.principal,securityEpoch: challenge.securityEpoch,publicKeySpkiBase64: key.publicKeySpkiBase64,keyAlias });
      const signature = await this.native.sign(keyAlias,encoded(payload),"Enable biometrics for LinqaVault and LinqaSend"); this.current();
      const platform = key.attestation && typeof key.attestation === "object" && "certificatesBase64" in key.attestation ? "ANDROID" : "IOS";
      return await this.request(context,"/v1/security/biometrics/enroll",{ method: "POST",body: JSON.stringify({ enrollmentId: challenge.enrollmentId,nonce: challenge.nonce,platform,keyAlias,publicKeySpkiBase64: key.publicKeySpkiBase64,signatureBase64: signature.signatureBase64,attestation: key.attestation }) });
    } catch (error) { await this.native.deleteKey(keyAlias).catch(() => undefined); throw error; }
  }
  async stepUp(purpose: BiometricPurpose,reference: { paymentChallengeId?: string; itemId?: string },prompt: string) {
    if (!this.native) throw new Error("Biometric signing requires a new native app build.");
    if (!(await this.status()).enrolled) await this.enroll();
    const context = await this.context();
    const challenge = await this.request<{ challengeId: string; challenge: string; purpose: BiometricPurpose; resourceHashHex: string; securityEpoch: number; keyAlias: string; payloadBase64: string; expiresAt: string }>(context,"/v1/security/biometrics/challenges",{ method: "POST",body: JSON.stringify({ purpose,...reference }) });
    const expected = encoded(stable({ v: 5,...context.principal,challengeId: challenge.challengeId,challenge: challenge.challenge,purpose: challenge.purpose,resourceHashHex: challenge.resourceHashHex,securityEpoch: challenge.securityEpoch }));
    if (challenge.purpose !== purpose || challenge.payloadBase64 !== expected || new Date(challenge.expiresAt).getTime() <= Date.now()) throw new Error("Invalid or expired biometric challenge.");
    this.current(); const signature = await this.native.sign(challenge.keyAlias,challenge.payloadBase64,prompt); this.current();
    return this.request<{ grantId: string; expiresAt: string }>(context,"/v1/security/biometrics/verify",{ method: "POST",body: JSON.stringify({ challengeId: challenge.challengeId,challenge: challenge.challenge,signatureBase64: signature.signatureBase64 }) });
  }
  async unlockVault() {
    const grant = await this.stepUp("VAULT_UNLOCK",{},"Unlock LinqaVault");
    return this.request<VaultUnlockSession>(await this.context(),"/v1/vault/private/unlock",{ method: "POST",body: JSON.stringify({ grantId: grant.grantId }) });
  }
  async privateItems<T>(session: VaultUnlockSession) {
    if (!(new Date(session.expiresAt).getTime()>Date.now())) throw new Error("Private Vault session expired. Unlock again.");
    return this.request<{ items: T[] }>(await this.context(),"/v1/vault/private/items",{ headers: { "x-vault-unlock-token": session.token } });
  }
  async lockVault(session: VaultUnlockSession) { return this.request(await this.context(),"/v1/vault/private/lock",{ method: "POST",body: JSON.stringify({ token: session.token }) }); }
  async revokeAll() {
    const status = await this.status();
    await this.request(await this.context(),"/v1/security/biometrics/credentials",{ method: "DELETE" });
    if (status.keyAlias && this.native) await this.native.deleteKey(status.keyAlias);
  }
}
