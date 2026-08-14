import type { PushProvider, TokenVault } from "../push.service.js";

/**
 * No APNs/FCM/Web Push adapter or KMS-backed token vault is configured (see
 * APPLY_GUIDE.txt items 3-4). Without a real vault there is no safe way to
 * store a raw push token, so both registration (`vault.encrypt`) and send
 * (`provider.send`) fail closed rather than storing tokens in plaintext or
 * silently dropping notifications.
 */
export class FailClosedPushProvider implements PushProvider {
  async send(): Promise<{ providerMessageId?: string }> {
    throw new Error("Push provider is not configured.");
  }
}

export class FailClosedTokenVault implements TokenVault {
  async encrypt(): Promise<Buffer> {
    throw new Error("Push token vault (KMS/HSM-backed) is not configured.");
  }

  async decrypt(): Promise<string> {
    throw new Error("Push token vault (KMS/HSM-backed) is not configured.");
  }
}
