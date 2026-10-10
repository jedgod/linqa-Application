import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { AesGcmCipher } from "../crypto/symmetric-cipher.js";
import { AccountDeletionService } from "../services/account-deletion.service.js";
import { AccountIntegrityService } from "../services/account-integrity.service.js";
import { AccountLimitService } from "../services/account-limit.service.js";
import { AccountPushIsolationService } from "../services/account-push-isolation.service.js";
import { SessionServiceAccountIssuer } from "../services/account-session-issuer.js";
import { AccountSwitchService } from "../services/account-switch.service.js";
import { AccountSwitchV3Service } from "../services/account-switch-v3.service.js";
import { AiJobService } from "../services/ai-job.service.js";
import { AbuseDecisionService } from "../services/abuse-decision.service.js";
import { AttachmentCdnService, FailClosedCdnSigner } from "../services/attachment-cdn.service.js";
import { AttachmentService } from "../services/attachment.service.js";
import { AuthChallengeService } from "../services/auth-challenge.service.js";
import { BackupIntegrityService } from "../services/backup-integrity.service.js";
import { HmacBillingWebhookVerifier } from "../services/billing/hmac-billing-webhook-verifier.js";
import { BillingReconciliationService, FailClosedBillingWebhookVerifier } from "../services/billing-reconciliation.service.js";
import { S3PresignedCdnSigner } from "../services/cdn/s3-presigned-cdn-signer.js";
import { BusinessProfileService } from "../services/business-profile.service.js";
import { CallService } from "../services/call.service.js";
import { CanaryReleaseService } from "../services/canary-release.service.js";
import { CollaborationService } from "../services/collaboration.service.js";
import { CommunityService } from "../services/community.service.js";
import { ContactDiscoveryService } from "../services/contact-discovery.service.js";
import { CountryLinqaService } from "../services/countrylinqa/service.js";
import { DatabasePhoneEvidenceProvider, HttpGeoIpProvider, NoopGeoIpProvider } from "../services/countrylinqa/providers.js";
import { RealSubscriptionProvider } from "../services/countrylinqa/entitlements.js";
import { CountryReverificationService } from "../services/countrylinqa/final/reverify.js";
import { DataResidencyService } from "../services/data-residency.service.js";
import {
  CompositeAuthDelivery,
  DevConsoleEmailDelivery,
  FailClosedEmailDelivery,
  HttpTransactionalEmailDelivery
} from "../services/email-delivery.service.js";
import { DeviceEnrollmentService } from "../services/device-enrollment.service.js";
import { DeviceFederationService } from "../services/device-federation.service.js";
import { DiagnosticRedactionService } from "../services/diagnostic-redaction.service.js";
import { DisappearingMessageService } from "../services/disappearing-message.service.js";
import { EmergencyEscalationService, FailClosedEscalationNotifier } from "../services/emergency-escalation.service.js";
import { WebhookEscalationNotifier } from "../services/emergency/webhook-escalation-notifier.js";
import { EntitlementService } from "../services/entitlement.service.js";
import { EnrollmentV2Service } from "../services/enrollment-v2.service.js";
import { EnterpriseIdentityV2Service } from "../services/enterprise-identity-v2.service.js";
import { EnterprisePolicyService } from "../services/enterprise-policy.service.js";
import { FeatureFlagService } from "../services/feature-flag.service.js";
import { FileVaultService } from "../services/file-vault.service.js";
import { GaReleaseGateService } from "../services/ga-release-gate.service.js";
import { GaRolloutService } from "../services/ga-rollout.service.js";
import { GapClosureService } from "../services/gap-closure.service.js";
import { GroupService } from "../services/group.service.js";
import { IncidentResponseService } from "../services/incident-response.service.js";
import { KeyTransparencyV2Service } from "../services/key-transparency-v2.service.js";
import { KillSwitchService } from "../services/kill-switch.service.js";
import { LegalHoldService } from "../services/legal-hold.service.js";
import { LocationSharingService } from "../services/location-sharing.service.js";
import { MilestoneService } from "../services/milestone.service.js";
import { FailClosedMlsGroupProvider, MlsGroupService } from "../services/mls-group.service.js";
import { FailClosedMlsProvider } from "../services/mls-provider.js";
import { DevMobileLineIntelligenceProvider, FailClosedMobileLineIntelligenceProvider } from "../services/mobile-line-intelligence.service.js";
import { DevConsoleMobileOtpDeliveryProvider, FailClosedOtpDeliveryProvider, MobileOtpService } from "../services/mobile-otp.service.js";
import { TwilioLookupProvider } from "../services/line-intelligence/twilio-lookup.provider.js";
import { TwilioOtpProvider } from "../services/otp/twilio-otp-provider.js";
import { MultiAccountService } from "../services/multi-account.service.js";
import { NetworkRiskService } from "../services/network-risk.service.js";
import { OnboardingService } from "../services/onboarding.service.js";
import { OrganizationAuthorizationService } from "../services/organization-authorization.service.js";
import { PasskeyV2Service } from "../services/passkey-v2.service.js";
import { PhoneNumberNormalizationService } from "../services/phone-number-normalization.service.js";
import { PhoneRegistrationService } from "../services/phone-registration.service.js";
import { PhoneRiskService } from "../services/phone-risk.service.js";
import { PrivacyRightsService } from "../services/privacy-rights.service.js";
import { PrivacySettingsService } from "../services/privacy-settings.service.js";
import { ProductionKillSwitchService } from "../services/production-kill-switch.service.js";
import { ProtocolCapabilityService } from "../services/protocol-capability.service.js";
import { PushV2Service, FailClosedPushV2Provider } from "../services/push-v2.service.js";
import { ApnsHttp2Provider } from "../services/push-providers/apns-http2.provider.js";
import { FcmHttpV1Provider } from "../services/push-providers/fcm-http-v1.provider.js";
import { CompositePushV2Provider } from "../services/push-providers/composite-push-v2.provider.js";
import { PushService } from "../services/push.service.js";
import {
  FailClosedPushProvider,
  FailClosedTokenVault
} from "../services/push/fail-closed-push-provider.js";
import { RecordedVideoService } from "../services/recorded-video.service.js";
import { RecoveryEmailService } from "../services/recovery-email.service.js";
import { ReleasePromotionService } from "../services/release-promotion.service.js";
import { RetentionArchiveService, FailClosedArchiveStorage } from "../services/retention-archive.service.js";
import { S3ArchiveStorage } from "../services/storage/s3-archive-storage.js";
import { ScimService } from "../services/scim.service.js";
import { SecurityAssessmentService } from "../services/security-assessment.service.js";
import { SessionService } from "../services/session.service.js";
import { SignalingService } from "../services/signaling.service.js";
import { FailClosedObjectStorage } from "../services/storage/fail-closed-object-storage.js";
import { S3ObjectStorage } from "../services/storage/s3-object-storage.js";
import { LocalVaultObjectStorage } from "../services/storage/local-vault-object-storage.js";
import {
  FailClosedVaultObjectStorage,
  S3VaultObjectStorage
} from "../services/storage/vault-object-storage.js";
import { SupportOperationsService } from "../services/support-operations.service.js";
import { SyncService } from "../services/sync.service.js";
import { TrustSafetyService } from "../services/trust-safety.service.js";
import { TurnRegionService } from "../services/turn-region.service.js";
import { UsernameService } from "../services/username.service.js";
import { Vertical2Service } from "../services/vertical-2.service.js";
import { FailClosedStepUpVerifier, StepUpService } from "../security/step-up.js";
import { PostgresStepUpConsumptionStore } from "../security/postgres-step-up-store.js";
import { createRuntimeCapabilityRegistry } from "../runtime/registry-factory.js";
import { OperationalProvider, ProviderRegistry, type ProviderHealth } from "../providers/provider-registry.js";

const readyHealth = async (id:string, configured:boolean, check?:()=>Promise<void>):Promise<ProviderHealth> => {
  if(!configured)return{state:"NOT_CONFIGURED",identity:id,reason:"provider is not configured"};
  const started=Date.now();
  try{await check?.();return{state:"READY",identity:id};}
  catch(error){return{state:"DEGRADED",identity:id,reason:`${String(error)} (${Date.now()-started}ms)`};}
};

export function createServiceContainer(config: AppConfig, db: Database) {
  const pushProvider = () => new FailClosedPushProvider();
  const objectStorage =
    config.OBJECT_STORAGE_REGION &&
    config.OBJECT_STORAGE_BUCKET &&
    config.OBJECT_STORAGE_KMS_KEY_ID
      ? new S3ObjectStorage({
          region: config.OBJECT_STORAGE_REGION,
          bucket: config.OBJECT_STORAGE_BUCKET,
          kmsKeyId: config.OBJECT_STORAGE_KMS_KEY_ID,
          ...(config.OBJECT_STORAGE_ENDPOINT
            ? { endpoint: config.OBJECT_STORAGE_ENDPOINT }
            : {}),
          ...(config.OBJECT_STORAGE_FORCE_PATH_STYLE === undefined
            ? {}
            : { forcePathStyle: config.OBJECT_STORAGE_FORCE_PATH_STYLE })
        })
      : new FailClosedObjectStorage();
  const vaultObjectStorage =
    config.OBJECT_STORAGE_REGION &&
    config.OBJECT_STORAGE_BUCKET &&
    config.OBJECT_STORAGE_KMS_KEY_ID
      ? new S3VaultObjectStorage({
          region: config.OBJECT_STORAGE_REGION,
          bucket: config.OBJECT_STORAGE_BUCKET,
          kmsKeyId: config.OBJECT_STORAGE_KMS_KEY_ID,
          ...(config.OBJECT_STORAGE_ENDPOINT
            ? { endpoint: config.OBJECT_STORAGE_ENDPOINT }
            : {}),
          ...(config.OBJECT_STORAGE_FORCE_PATH_STYLE === undefined
            ? {}
            : { forcePathStyle: config.OBJECT_STORAGE_FORCE_PATH_STYLE })
        })
      // Development only: without a bucket, encrypted objects go to a local folder. Production keeps failing closed.
      : config.NODE_ENV !== "production"
        ? new LocalVaultObjectStorage(config.JWT_HS256_SECRET)
        : new FailClosedVaultObjectStorage();

  const sessions = new SessionService(db, config);
  // Envelope encryption for the multi-account pack's phone-number and
  // push-token ciphers, backed by the same root key already provisioned
  // for the (previously fail-closed-only) push token vault.
  const tokenCipher = new AesGcmCipher(config.TOKEN_VAULT_KEY_BASE64);
  const accountLimits = new AccountLimitService(db);
  const gaGates = new GaReleaseGateService(db);
  const phoneNormalization = new PhoneNumberNormalizationService();
  const phoneRisk = new PhoneRiskService();

  // 2026-08-07/08: real-when-configured providers, each following the same
  // "all required fields present -> real implementation, else fail
  // closed" pattern already established by objectStorage/vaultObjectStorage
  // above. Restored 2026-08-08 after a concurrent-edit collision with a
  // separate agent session's CountryLinqa work deleted this entire block —
  // see docs/reference/assessments/claudeassess.txt / conversation history. OTP and line-intelligence
  // are now layered three ways (real Twilio -> dev-console fallback in
  // non-production, from the other session's work -> fail closed in
  // production) instead of the two competing single-layer solutions that
  // existed right after the collision.
  const apnsProvider =
    config.APNS_TEAM_ID && config.APNS_KEY_ID && config.APNS_PRIVATE_KEY_P8 && config.APNS_BUNDLE_ID
      ? new ApnsHttp2Provider(config.APNS_TEAM_ID, config.APNS_KEY_ID, config.APNS_PRIVATE_KEY_P8, config.APNS_SANDBOX)
      : null;
  const fcmProvider =
    config.FCM_PROJECT_ID && config.FCM_CLIENT_EMAIL && config.FCM_PRIVATE_KEY
      ? new FcmHttpV1Provider(config.FCM_PROJECT_ID, config.FCM_CLIENT_EMAIL, config.FCM_PRIVATE_KEY)
      : null;
  const pushV2Provider =
    apnsProvider || fcmProvider ? new CompositePushV2Provider(apnsProvider, fcmProvider) : new FailClosedPushV2Provider();
  const pushV2 = new PushV2Service(db, pushV2Provider, (ciphertext) => tokenCipher.decrypt(ciphertext));

  const cdnSigner =
    config.CDN_STORAGE_BUCKET && config.CDN_STORAGE_REGION
      ? new S3PresignedCdnSigner({ bucket: config.CDN_STORAGE_BUCKET, region: config.CDN_STORAGE_REGION })
      : new FailClosedCdnSigner();

  const billingVerifier = config.BILLING_WEBHOOK_SECRET
    ? new HmacBillingWebhookVerifier(config.BILLING_WEBHOOK_SECRET, config.BILLING_WEBHOOK_TOLERANCE_SECONDS)
    : new FailClosedBillingWebhookVerifier();

  const escalationNotifier =
    config.ESCALATION_STAFF_WEBHOOK_URL && config.ESCALATION_STAFF_WEBHOOK_SECRET
      ? new WebhookEscalationNotifier(pushV2, config.ESCALATION_STAFF_WEBHOOK_URL, config.ESCALATION_STAFF_WEBHOOK_SECRET)
      : new FailClosedEscalationNotifier();

  const lineIntelligenceProvider =
    config.TWILIO_LOOKUP_ACCOUNT_SID && config.TWILIO_LOOKUP_AUTH_TOKEN
      ? new TwilioLookupProvider(config.TWILIO_LOOKUP_ACCOUNT_SID, config.TWILIO_LOOKUP_AUTH_TOKEN)
      : config.NODE_ENV === "production"
        ? new FailClosedMobileLineIntelligenceProvider()
        : new DevMobileLineIntelligenceProvider(config);

  const otpProvider =
    config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_FROM_NUMBER
      ? new TwilioOtpProvider(
          config.TWILIO_ACCOUNT_SID,
          config.TWILIO_AUTH_TOKEN,
          config.TWILIO_FROM_NUMBER,
          config.TWILIO_VOICE_FROM_NUMBER
        )
      : config.NODE_ENV === "production"
        ? new FailClosedOtpDeliveryProvider()
        : new DevConsoleMobileOtpDeliveryProvider(config);
  const mobileOtp = new MobileOtpService(db, otpProvider);
  const emailDelivery =
    config.EMAIL_DELIVERY_URL && config.EMAIL_DELIVERY_HEALTH_URL && config.EMAIL_DELIVERY_TOKEN && config.EMAIL_FROM
      ? new HttpTransactionalEmailDelivery(
          config.EMAIL_DELIVERY_URL,
          config.EMAIL_DELIVERY_TOKEN,
          config.EMAIL_FROM,
          config.EMAIL_DELIVERY_HEALTH_URL
        )
      : config.NODE_ENV === "production"
        ? new FailClosedEmailDelivery()
        : new DevConsoleEmailDelivery(config);
  const providerRegistry = new ProviderRegistry()
    .register(new OperationalProvider("sms-delivery", config.TWILIO_ACCOUNT_SID ? "twilio" : "unconfigured-sms", "1", otpProvider,
      () => readyHealth("twilio", Boolean(config.TWILIO_ACCOUNT_SID), otpProvider instanceof TwilioOtpProvider ? () => otpProvider.health() : undefined)))
    .register(new OperationalProvider("email-delivery", config.EMAIL_DELIVERY_URL ? "transactional-email" : "unconfigured-email", "1", emailDelivery,
      () => readyHealth("transactional-email", Boolean(config.EMAIL_DELIVERY_URL), emailDelivery instanceof HttpTransactionalEmailDelivery ? () => emailDelivery.health() : undefined)))
    .register(new OperationalProvider("push", apnsProvider && fcmProvider ? "apns-fcm" : "unconfigured-push", "1", pushV2Provider,
      () => readyHealth("apns-fcm", Boolean(apnsProvider && fcmProvider), pushV2Provider instanceof CompositePushV2Provider ? () => pushV2Provider.health() : undefined)))
    .register(new OperationalProvider("object-storage", objectStorage instanceof S3ObjectStorage ? "s3" : "unconfigured-object-storage", "1", objectStorage,
      () => readyHealth("s3", objectStorage instanceof S3ObjectStorage, objectStorage instanceof S3ObjectStorage ? () => objectStorage.health() : undefined)));
  const authDelivery = new CompositeAuthDelivery(
    providerRegistry.resolve("sms-delivery"),
    providerRegistry.resolve("email-delivery")
  );
  const recoveryEmails = new RecoveryEmailService(db, tokenCipher, emailDelivery);
  const sessionIssuer = new SessionServiceAccountIssuer(sessions);
  const phoneRegistration = new PhoneRegistrationService(
    db,
    phoneNormalization,
    tokenCipher
  );

  const archiveStorage =
    config.ARCHIVE_STORAGE_BUCKET && config.ARCHIVE_STORAGE_REGION && config.ARCHIVE_STORAGE_KMS_KEY_ID
      ? new S3ArchiveStorage({
          bucket: config.ARCHIVE_STORAGE_BUCKET,
          region: config.ARCHIVE_STORAGE_REGION,
          kmsKeyId: config.ARCHIVE_STORAGE_KMS_KEY_ID
        })
      : new FailClosedArchiveStorage();
  const stepUp = config.STEP_UP_PRIVATE_KEY_PEM && config.STEP_UP_PUBLIC_KEY_PEM
    ? new StepUpService(
        config.STEP_UP_PRIVATE_KEY_PEM,
        config.STEP_UP_PUBLIC_KEY_PEM,
        new PostgresStepUpConsumptionStore(db)
      )
    : new FailClosedStepUpVerifier();

  return {
    abuseDecisions: new AbuseDecisionService(db),
    accountDeletion: new AccountDeletionService(db),
    accountIntegrity: new AccountIntegrityService(db),
    accountLimits,
    accountPushIsolation: new AccountPushIsolationService(db, tokenCipher),
    accountSwitch: new AccountSwitchService(db, sessionIssuer),
    accountSwitchV3: new AccountSwitchV3Service(db, sessionIssuer),
    ai: new AiJobService(db),
    attachmentCdn: new AttachmentCdnService(db, cdnSigner),
    attachments: new AttachmentService(db, objectStorage),
    authChallenges: new AuthChallengeService(db, config, authDelivery, {
      normalizer: phoneNormalization,
      intelligence: lineIntelligenceProvider,
      risk: phoneRisk
    }),
    backupIntegrity: new BackupIntegrityService(db),
    billingReconciliation: new BillingReconciliationService(db, billingVerifier),
    businesses: new BusinessProfileService(db),
    calls: new CallService(db),
    canaryReleases: new CanaryReleaseService(db),
    collaboration: new CollaborationService(db),
    communities: new CommunityService(db),
    contactDiscovery: new ContactDiscoveryService(
      db,
      config.CONTACT_DISCOVERY_SECRET
    ),
    dataResidency: new DataResidencyService(db),
    deviceEnrollment: new DeviceEnrollmentService(db),
    deviceFederation: new DeviceFederationService(db),
    diagnosticRedaction: new DiagnosticRedactionService(),
    disappearingMessages: new DisappearingMessageService(db),
    emergencyEscalation: new EmergencyEscalationService(db, escalationNotifier),
    enrollmentV2: new EnrollmentV2Service(db),
    entitlements: new EntitlementService(db),
    enterprise: new EnterprisePolicyService(db),
    enterpriseIdentityV2: new EnterpriseIdentityV2Service(db),
    featureFlags: new FeatureFlagService(db),
    fileVault: new FileVaultService(db, vaultObjectStorage),
    gaGates,
    gaRollout: new GaRolloutService(db, gaGates),
    gap: new GapClosureService(db),
    groups: new GroupService(db),
    incidentResponse: new IncidentResponseService(db),
    keyTransparency: new KeyTransparencyV2Service(db),
    killSwitches: new KillSwitchService(db),
    legalHolds: new LegalHoldService(db),
    location: new LocationSharingService(db),
    milestones: new MilestoneService(db),
    mls: new FailClosedMlsProvider(),
    mlsGroups: new MlsGroupService(db, new FailClosedMlsGroupProvider()),
    mobileOtp,
    multiAccount: new MultiAccountService(db, accountLimits),
    networkRisk: new NetworkRiskService(db),
    onboarding: new OnboardingService(db),
    orgAuthorization: new OrganizationAuthorizationService(db),
    passkeys: new PasskeyV2Service(db, {
      rpName: config.PASSKEY_RP_NAME,
      rpId: config.PASSKEY_RP_ID,
      origins: config.PASSKEY_ORIGINS
    }),
    phoneRegistration,
    privacyRights: new PrivacyRightsService(db),
    privacySettings: new PrivacySettingsService(db),
    productionKillSwitches: new ProductionKillSwitchService(db),
    promotions: new ReleasePromotionService(db),
    protocolCapabilities: new ProtocolCapabilityService(db),
    push: new PushService(db, new FailClosedTokenVault(), {
      APNS: pushProvider(),
      FCM: pushProvider(),
      WEB_PUSH: pushProvider()
    }),
    pushV2,
    recordedVideos: new RecordedVideoService(db),
    recoveryEmails,
    runtimeCapabilities: createRuntimeCapabilityRegistry(config, db, providerRegistry),
    providerRegistry,
    retentionArchive: new RetentionArchiveService(db, archiveStorage),
    scim: new ScimService(db),
    securityAssessment: new SecurityAssessmentService(db),
    sessions,
    signaling: new SignalingService(db),
    supportOperations: new SupportOperationsService(db),
    stepUp,
    sync: new SyncService(db),
    trustSafety: new TrustSafetyService(db),
    turnRegions: new TurnRegionService(db, config.TURN_SHARED_SECRET),
    usernames: new UsernameService(db),
    vertical2: new Vertical2Service(db),
    countryLinqa: new CountryLinqaService(
      db,
      config,
      new RealSubscriptionProvider(db),
      new DatabasePhoneEvidenceProvider(db),
      config.COUNTRYLINQA_GEOIP_URL
        ? new HttpGeoIpProvider(config.COUNTRYLINQA_GEOIP_URL, config.COUNTRYLINQA_GEOIP_TOKEN)
        : new NoopGeoIpProvider()
    ),
    countryReverification: new CountryReverificationService(
      db,
      new DatabasePhoneEvidenceProvider(db),
      config.COUNTRYLINQA_GEOIP_URL
        ? new HttpGeoIpProvider(config.COUNTRYLINQA_GEOIP_URL, config.COUNTRYLINQA_GEOIP_TOKEN)
        : new NoopGeoIpProvider()
    )
  };
}

export type ServiceContainer = ReturnType<typeof createServiceContainer>;
