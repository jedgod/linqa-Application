/**
 * Provider contracts from Vault v6.0 and v7.0, merged. Every default is "unconfigured" and throws,
 * so a sharing, billing, mail, storage or scanning action can never appear to succeed without a
 * real provider behind it. Nothing in here holds a Vault content key.
 */
export class ProviderUnavailableError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface Principal {
  userId: string;
  deviceId: string;
  sessionId?: string | undefined;
}

export interface StepUpAdapter {
  /** Verifies a signed step-up proof for one purpose on this device and consumes it (one use). */
  verifyAndConsume(input: { userId: string; deviceId: string; proof: string; purpose: "VAULT_EXPORT_SOCIAL" }): Promise<{ jti: string }>;
}

export interface PlatformSecurityAdapter {
  getTwoFactor(userId: string): Promise<{ enabled: boolean; methods: string[] }>;
  getTrustedDevices(userId: string): Promise<Array<{ id: string; name: string; platform: string; trusted: boolean; lastSeenAt: string | null }>>;
  getLoginAlertPreference(userId: string): Promise<{ enabled: boolean }>;
  setLoginAlertPreference(userId: string, enabled: boolean): Promise<void>;
}

export interface UserDirectory {
  resolve(handle: string): Promise<{ userId: string } | null>;
}

export interface Mailer {
  readonly name: string;
  sendSecureVaultLink(input: { to: string; url: string; expiresAt: string }): Promise<{ providerRef: string }>;
}

export interface CheckoutInput {
  customerRef?: string | undefined;
  userId: string;
  planCode: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface BillingProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<{ sessionRef: string; checkoutUrl: string; customerRef?: string | undefined }>;
  /** Verifies the signature over the exact raw bytes. Throws if it does not verify. */
  verifyWebhook(raw: Buffer, signature: string): Promise<{ eventId: string; type: string; userId?: string; planCode?: string; sessionRef?: string; subscriptionRef?: string; periodEnd?: string }>;
}

export interface CiphertextStore {
  readonly name: string;
  /** A short-lived URL the device uploads ciphertext to. The key is chosen by the server, never the client. */
  createUpload(input: { workspaceId: string; objectId: string; storageKey: string; size: number; mediaType: string }): Promise<{ uploadUrl: string }>;
  /** A short-lived URL for downloading ciphertext. Never returned for plaintext or quarantine objects. */
  signedGet(storageKey: string, ttlSeconds: number): Promise<string>;
  head(storageKey: string): Promise<{ size: number; sha256?: string | undefined }>;
  /** Server-side copy to a new key, so an export never exposes the object's own key or id. */
  copy(fromKey: string, toKey: string): Promise<void>;
  delete(storageKey: string): Promise<void>;
}

export interface QuarantineReader {
  /** A short-lived URL to the clean quarantine copy. Only handed to the owning device with a one-use grant. */
  signedGet(key: string, ttlSeconds: number): Promise<string>;
}

export interface SocialCopyAdapter {
  readonly name: string;
  /** Creates a NEW social attachment from the ciphertext. The Vault object id and storage key never go to Social. */
  createCopy(input: { userId: string; grantId: string; destinationRef?: string | undefined; ciphertextDownloadUrl: string; metadata: Record<string, unknown> }): Promise<{ socialObjectId: string }>;
}

export interface VaultProviders {
  stepUp: StepUpAdapter;
  platform: PlatformSecurityAdapter;
  users: UserDirectory;
  mail: Mailer;
  billing: BillingProvider;
  ciphertext: CiphertextStore;
  quarantineReader: QuarantineReader;
  socialCopy: SocialCopyAdapter;
}

const off = (code: string) => async (): Promise<never> => { throw new ProviderUnavailableError(code); };

export function unconfiguredProviders(live: Pick<VaultProviders, "stepUp" | "platform" | "users">): VaultProviders {
  return {
    ...live,
    mail: { name: "unconfigured", sendSecureVaultLink: off("MAIL_NOT_CONFIGURED") },
    billing: { name: "unconfigured", createCheckout: off("BILLING_NOT_CONFIGURED"), verifyWebhook: off("BILLING_NOT_CONFIGURED") },
    ciphertext: { name: "unconfigured", createUpload: off("CIPHERTEXT_STORE_NOT_CONFIGURED"), signedGet: off("CIPHERTEXT_STORE_NOT_CONFIGURED"), head: off("CIPHERTEXT_STORE_NOT_CONFIGURED"), copy: off("CIPHERTEXT_STORE_NOT_CONFIGURED"), async delete() { /* nothing stored */ } },
    quarantineReader: { signedGet: off("QUARANTINE_STORE_NOT_CONFIGURED") },
    socialCopy: { name: "unconfigured", createCopy: off("SOCIAL_EXPORT_NOT_CONFIGURED") }
  };
}

/** What the Security Center and integration status report as genuinely switched on. */
export function providerFlags(p: VaultProviders) {
  return {
    sharing: p.ciphertext.name !== "unconfigured",
    email: p.mail.name !== "unconfigured",
    billing: p.billing.name !== "unconfigured",
    socialExport: p.socialCopy.name !== "unconfigured"
  };
}
