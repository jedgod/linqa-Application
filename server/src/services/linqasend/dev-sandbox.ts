import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { AppConfig } from "../../config.js";
import type { KmsHealth, ProductionKmsProvider } from "../../security/kms/production-kms-provider.js";
import type { FundingAuthorizationResult, LinqaSendProviders, PayoutResult } from "../../integrations/linqasend/provider.contracts.js";

/**
 * Development-only stand-ins that let the card-registration flow run against a local sandbox
 * provider. config.ts refuses LINQASEND_DEV_SANDBOX unless NODE_ENV=development, real money is off,
 * the mode is SANDBOX_CERTIFICATION and no real provider/KMS is configured, so none of this can be
 * active in a money-moving deployment. The sandbox provider id is never treated as certified for
 * payouts, readiness or transfer execution: it is accepted only when saving a funding source.
 */
export const DEV_SANDBOX_PROVIDER_ID = "dev-sandbox";
export const DEV_SANDBOX_KEY_ID = "dev-sandbox-local-key";

export function devSandboxCardProvider(config: AppConfig): { url: string; token: string } | null {
  if (config.LINQASEND_DEV_SANDBOX !== true || config.NODE_ENV !== "development") return null;
  if (!config.LINQASEND_DEV_CARD_PROVIDER_URL || !config.LINQASEND_DEV_CARD_PROVIDER_TOKEN) return null;
  return { url: config.LINQASEND_DEV_CARD_PROVIDER_URL, token: config.LINQASEND_DEV_CARD_PROVIDER_TOKEN };
}

/**
 * Sandbox-only stand-in for a customer KYC verification. It is deliberately NOT `VERIFIED`: a
 * production query for VERIFIED profiles never matches it, and readiness accepts it only while the
 * development sandbox is active (config.ts forbids that outside development with real money off).
 */
export const DEV_SANDBOX_KYC_STATUS = "DEV_SANDBOX_UNVERIFIED";
export const DEV_SANDBOX_KYC_EVIDENCE = "DEV_SANDBOX_NOT_REAL_KYC";

export function acceptedKycStatuses(devSandbox: boolean): string[] {
  return devSandbox ? ["VERIFIED", DEV_SANDBOX_KYC_STATUS] : ["VERIFIED"];
}

/** Downstream rules see the sandbox marker as a verified level-1 customer; the stored row never says VERIFIED. */
export function effectiveKycStatus(status: string): string {
  return status === DEV_SANDBOX_KYC_STATUS ? "VERIFIED" : status;
}

/**
 * Readiness blockers that are pure configuration/real-money switches. They are excused only for a
 * domestic transfer funded by the `dev-sandbox` provider while the sandbox is active; every other
 * blocker (certification, liquidity, sanctions, etc.) still applies.
 */
export const DEV_SANDBOX_EXCUSABLE_BLOCKERS: ReadonlySet<string> = new Set([
  "REAL_MONEY_DISABLED",
  "GLOBAL_KILL_SWITCH_ACTIVE_OR_MISSING",
  "COUNTRY_CAPABILITY_NOT_CONFIGURED",
  "FINANCIAL_RESPONSIBILITY_MAP_NOT_CONFIGURED"
]);

const SANDBOX_MAX_MINOR = 500_000n;

/** In-process simulated providers: no network, no money. Registered only while the sandbox is active. */
export function createDevSandboxProviders(): LinqaSendProviders {
  const funding = new Map<string, FundingAuthorizationResult>();
  const payouts = new Map<string, PayoutResult>();
  return {
    kyc: { name: "dev-sandbox", verifyIdentity: async () => ({ decision: "PASS" as const, reasons: ["dev_sandbox_simulation"] }) },
    compliance: { name: "dev-sandbox", screenPerson: async () => ({ decision: "CLEAR" as const, reasons: ["dev_sandbox_simulation"] }) },
    funding: {
      name: "dev-sandbox",
      async authorizeFunding(input) {
        const result: FundingAuthorizationResult = input.currency === "USD" && input.amountMinor > 0n && input.amountMinor <= SANDBOX_MAX_MINOR
          ? { status: "AUTHORIZED", providerRef: `dev_fund_${input.transferId.replaceAll("-", "").slice(0, 16)}` }
          : { status: "DECLINED", declineCode: "dev_sandbox_limits" };
        funding.set(input.idempotencyKey, result);
        return result;
      },
      async lookupByIdempotencyKey(key) { return funding.get(key) ?? null; }
    },
    payout: {
      name: "dev-sandbox",
      async createPayout(input) {
        if (input.currency !== "USD" || input.amountMinor <= 0n || input.amountMinor > SANDBOX_MAX_MINOR) throw new Error("dev_sandbox_limits");
        const result: PayoutResult = { status: "COMPLETED", providerRef: `dev_payout_${input.transferId.replaceAll("-", "").slice(0, 16)}` };
        payouts.set(result.providerRef, result);
        return result;
      },
      async lookup(ref) { return payouts.get(ref) ?? null; }
    },
    fx: { async fetchFxRate() { throw new Error("Live FX rate provider is not configured; publish a rate to linqasend_fx_rate_snapshots instead."); } }
  };
}

/** Local AES-GCM key wrapping with a key derived from the API's own secret; stands in for AWS KMS in development. */
export class DevLocalKmsProvider implements ProductionKmsProvider {
  private readonly key: Buffer;
  constructor(secret: string) { this.key = Buffer.from(hkdfSync("sha256", secret, "linqasend-dev-sandbox", "dev-kms-wrap-v1", 32)); }

  async encrypt(input: { plaintext: Buffer; context: Record<string, string> }) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify(input.context)));
    const body = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), body]);
  }

  async decrypt(input: { ciphertext: Buffer; context: Record<string, string> }) {
    const nonce = input.ciphertext.subarray(0, 12), tag = input.ciphertext.subarray(12, 28), body = input.ciphertext.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
    decipher.setAAD(Buffer.from(JSON.stringify(input.context)));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  }

  async generateDataKey(input: { context: Record<string, string> }) {
    const plaintext = randomBytes(32);
    return { plaintext, ciphertext: await this.encrypt({ plaintext, context: input.context }) };
  }

  async health(): Promise<KmsHealth> { return { state: "READY", keyId: DEV_SANDBOX_KEY_ID, checkedAt: new Date().toISOString(), reason: "development-only local key" }; }
}
