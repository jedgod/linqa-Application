import crypto from "node:crypto";

export type SensitiveAction =
  | "PHONE_CHANGE" | "RECOVERY_EMAIL_CHANGE" | "ACCOUNT_RECOVERY"
  | "DEVICE_REVOKE" | "DATA_EXPORT" | "ACCOUNT_DELETE" | "PASSKEY_REMOVE"
  | "BACKUP_KEY_ROTATE" | "COUNTRY_OVERRIDE" | "LINQASEND_FUNDING_SOURCE_CHANGE"
  | "LINQASEND_TRANSFER_CONFIRM";
export interface StepUpClaims {
  iss: "linqa"; aud: "linqa-sensitive-actions"; sub: string; deviceId: string;
  action: SensitiveAction; authn: "PASSKEY" | "DEVICE_PROOF"; jti: string; iat: number; exp: number;
}
export interface StepUpConsumptionStore { consumeOnce(jti: string, expiresAtSeconds: number): Promise<boolean>; }
export interface StepUpVerifier {
  verifyAndConsume(token: string, expected: { userId: string; deviceId: string; action: SensitiveAction }): Promise<StepUpClaims>;
}
const b64u = (buffer: Buffer) => buffer.toString("base64url");

export class StepUpService implements StepUpVerifier {
  constructor(private readonly privateKeyPem: string, private readonly publicKeyPem: string, private readonly consumed: StepUpConsumptionStore) {}
  issue(input: { userId: string; deviceId: string; action: SensitiveAction; authn: StepUpClaims["authn"]; ttlSeconds?: number }): string {
    const now = Math.floor(Date.now() / 1000);
    const claims: StepUpClaims = {
      iss: "linqa", aud: "linqa-sensitive-actions", sub: input.userId, deviceId: input.deviceId,
      action: input.action, authn: input.authn, jti: crypto.randomUUID(), iat: now,
      exp: now + Math.max(1, Math.min(input.ttlSeconds ?? 300, 300))
    };
    const header = { alg: "EdDSA", typ: "JWT", kid: "stepup-v1" };
    const signingInput = `${b64u(Buffer.from(JSON.stringify(header)))}.${b64u(Buffer.from(JSON.stringify(claims)))}`;
    return `${signingInput}.${b64u(crypto.sign(null, Buffer.from(signingInput), this.privateKeyPem))}`;
  }
  async verifyAndConsume(token: string, expected: { userId: string; deviceId: string; action: SensitiveAction }): Promise<StepUpClaims> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("STEP_UP_MALFORMED");
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    if (b64u(Buffer.from(headerPart, "base64url")) !== headerPart || b64u(Buffer.from(payloadPart, "base64url")) !== payloadPart) {
      throw new Error("STEP_UP_MALFORMED");
    }
    if (b64u(Buffer.from(signaturePart, "base64url")) !== signaturePart) throw new Error("STEP_UP_SIGNATURE_INVALID");
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as { alg?: string; typ?: string; kid?: string };
    if (header.alg !== "EdDSA" || header.typ !== "JWT" || header.kid !== "stepup-v1") throw new Error("STEP_UP_HEADER_INVALID");
    if (!crypto.verify(null, Buffer.from(`${headerPart}.${payloadPart}`), this.publicKeyPem, Buffer.from(signaturePart, "base64url"))) {
      throw new Error("STEP_UP_SIGNATURE_INVALID");
    }
    const claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as StepUpClaims;
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== "linqa" || claims.aud !== "linqa-sensitive-actions") throw new Error("STEP_UP_AUDIENCE_INVALID");
    if (claims.exp <= now || claims.iat > now + 30 || claims.exp - claims.iat > 300) throw new Error("STEP_UP_EXPIRED");
    if (claims.sub !== expected.userId || claims.deviceId !== expected.deviceId || claims.action !== expected.action) throw new Error("STEP_UP_BINDING_FAILED");
    if (!(await this.consumed.consumeOnce(claims.jti, claims.exp))) throw new Error("STEP_UP_REPLAYED");
    return claims;
  }
}

export class FailClosedStepUpVerifier implements StepUpVerifier {
  async verifyAndConsume(): Promise<never> { throw new Error("STEP_UP_NOT_CONFIGURED"); }
}
