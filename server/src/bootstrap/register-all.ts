import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { RealtimeHub } from "../realtime/hub.js";
import { registerRealtime } from "../realtime/register.js";
import { registerSignaling } from "../realtime/signaling.register.js";
import { registerAccountDeletionRoutes } from "../routes/account-deletion.js";
import { registerAccountIdentifierRoutes } from "../routes/account-identifiers.js";
import { registerAttachmentRoutes } from "../routes/attachments.js";
import { registerAuthRoutes } from "../routes/auth.js";
import { registerCallRoutes } from "../routes/calls.js";
import { registerCallsV2Routes } from "../calls/calls-v2.routes.js";
import { registerContactDiscoveryRoutes } from "../routes/contact-discovery.js";
import { registerCountryLinqaRoutes } from "../routes/countrylinqa/routes.js";
import { registerCountryLinqaGoLiveRoutes } from "../routes/countrylinqa/golive-routes.js";
import { registerCountryLinqaFinalRoutes } from "../routes/countrylinqa/final-routes.js";
import { registerCountryLinqaEngineRoutes } from "../routes/countrylinqa/engine-routes.js";
import { registerCountryLinqaPlanRoutes } from "../routes/countrylinqa/plan-routes.js";
import { registerCountryLinqaAdminRoutes } from "../routes/countrylinqa/admin-routes.js";
import { registerCountryLinqaSecurityRoutes } from "../routes/countrylinqa/security-routes.js";
import { registerEnrollmentRoutes } from "../routes/enrollment.js";
import { registerEntitlementRoutes } from "../routes/entitlements.js";
import { registerExecutionLaunchRoutes } from "../routes/execution-launch.js";
import { registerFeatureFlagRoutes } from "../routes/feature-flags.js";
import { registerFileVaultRoutes } from "../routes/file-vault.js";
import { registerBiometricRoutes } from "../routes/biometrics.js";
import { BiometricAuthorizationService } from "../security/biometrics/service.js";
import { biometricAttestation } from "../security/biometrics/attestation.js";
import { registerVaultIntakeRoutes } from "../routes/vault-intake.js";
import { registerFinalUnwiredRoutes } from "../routes/final-unwired.js";
import { registerGaHardeningRoutes } from "../routes/ga-hardening.routes.js";
import { createHomeModule } from "../home/home.module.js";
import { registerChatRoutes } from "../routes/chats.js";
import { registerChatV2Routes } from "../chat/chat-v2.routes.js";
import { registerThreadAttachmentRoutes } from "../chat/thread-attachment.routes.js";
import { registerChatFeatureRoutes } from "../chat/chat-feature.routes.js";
import { registerLiveScreenRoutes } from "../chat/live-screen.routes.js";
import { createChatBus } from "../chat/chat-redis-bus.js";
import { startChatBusSubscriber } from "../chat/chat-outbox.service.js";
import { registerHomeRoutes } from "../home/home.routes.js";
import { registerHomeAdminRoutes } from "../home/home-admin.routes.js";
import { registerGapClosureRoutes } from "../routes/gap-closure.js";
import { registerKeyPackageRoutes } from "../routes/key-packages.js";
import { registerLinqaSendRoutes } from "../routes/linqasend/routes.js";
import { registerMilestone3Routes } from "../routes/milestone-3.routes.js";
import { registerMilestonePlatformRoutes } from "../routes/milestone-platform.js";
import { registerMobileFeatureRoutes } from "../routes/mobile-features.js";
import { registerMobileHubRoutes } from "../routes/mobile-hub.js";
import { registerMultiAccountRoutes } from "../routes/multi-account.routes.js";
import { registerNextMobileFeatureRoutes } from "../routes/next-mobile-features.js";
import { registerOnboardingRoutes } from "../routes/onboarding.js";
import { registerOperationsRoutes } from "../routes/operations/index.js";
import { registerPasskeyRoutes } from "../routes/passkeys.js";
import { registerPrivacyRoutes } from "../routes/privacy.js";
import { registerProtocolCapabilityRoutes } from "../routes/protocol-capability.js";
import { registerPushRoutes } from "../routes/push.js";
import { registerRecordedVideoRoutes } from "../routes/recorded-videos.js";
import { registerRelayRoutes } from "../routes/relay.js";
import { registerRuntimeRoutes } from "../routes/runtime.js";
import { registerSafetyRoutes } from "../routes/safety.js";
import { registerSyncRoutes } from "../routes/sync.js";
import { registerUsernameRoutes } from "../routes/usernames.js";
import { registerLocalVaultBlobRoutes } from "../services/storage/local-vault-object-storage.js";
import { registerAssistantRoutes } from "../ai/assistant.routes.js";
import { registerVertical2Routes } from "../routes/vertical-2.routes.js";
import type { MetricsRegistry } from "../observability/metrics-registry.js";
import type { ServiceContainer } from "./service-container.js";

export async function registerAll(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  services: ServiceContainer,
  metrics?: MetricsRegistry
) {
  const hub = new RealtimeHub();
  const biometrics = new BiometricAuthorizationService(db,config.NODE_ENV === "production",biometricAttestation(config));
  await registerBiometricRoutes(app,config,biometrics);

  await registerRelayRoutes(app, config, db, hub);
  await registerKeyPackageRoutes(app, config, db);
  // Device enrollment: `routes/enrollment.ts` is the one wired, working
  // mechanism (real Ed25519 proof verification via server/src/auth/
  // enrollment-proof.ts). `routes/enrollment-v2.ts` and the device-enrollment
  // handler that used to live in `routes/gap-closure.ts` were two other,
  // never-finished mechanisms found registered alongside this one during the
  // 2026-08-07 diagnostic; both are left on disk (dormant, unregistered) but
  // intentionally not mounted here to avoid three competing, confusing
  // enrollment paths. See docs/reference/assessments/claudeassess.txt, "TODAY ASSESS TXT".
  await registerEnrollmentRoutes(app, config, db, services.sessions);
  await registerAuthRoutes(app, config, db, {
    challengeService: services.authChallenges,
    sessionService: services.sessions,
    phoneRegistration: services.phoneRegistration,
    onboarding: services.onboarding
  });
  await registerOnboardingRoutes(app, config, services.onboarding);
  await registerAttachmentRoutes(
    app,
    config,
    db,
    services.attachments,
    services.killSwitches
  );
  await registerSyncRoutes(app, config, db, services.sync);
  await registerAccountDeletionRoutes(app, config, services.accountDeletion, services.stepUp);
  await registerCallRoutes(app, config, services.calls, services.location);
  await registerCallsV2Routes(app, config, db, services.calls, hub);
  await registerRecordedVideoRoutes(app, config, services.recordedVideos);
  await registerPushRoutes(app, config, services.push);
  await registerContactDiscoveryRoutes(app, config, services.contactDiscovery);
  await registerSafetyRoutes(app, config, services.trustSafety);
  await registerUsernameRoutes(app, config, services.usernames);
  await registerPrivacyRoutes(app, config, services.privacySettings);
  await registerEntitlementRoutes(app, config, services.entitlements);
  await registerProtocolCapabilityRoutes(
    app,
    config,
    services.protocolCapabilities
  );
  await registerFeatureFlagRoutes(app, config, services.featureFlags);
  await registerRuntimeRoutes(app, config, db, services.runtimeCapabilities);
  await registerFinalUnwiredRoutes(app, config, services);
  await registerAssistantRoutes(app, config, db);
  await registerMilestonePlatformRoutes(app, config, {
    milestones: services.milestones,
    collaboration: services.collaboration,
    ai: services.ai,
    enterprise: services.enterprise,
    orgAuthorization: services.orgAuthorization
  });
  await registerExecutionLaunchRoutes(app, config, {
    promotions: services.promotions,
    communities: services.communities,
    businesses: services.businesses,
    scim: services.scim,
    legalHolds: services.legalHolds,
    orgAuthorization: services.orgAuthorization
  });
  await registerGapClosureRoutes(app, config, db, {
    gap: services.gap
  });
  await registerPasskeyRoutes(app, config, services.passkeys, services.stepUp);
  await registerFileVaultRoutes(app, config, services.fileVault, undefined, biometrics);
  if (config.NODE_ENV !== "production" && !(config.OBJECT_STORAGE_REGION && config.OBJECT_STORAGE_BUCKET && config.OBJECT_STORAGE_KMS_KEY_ID)) {
    await registerLocalVaultBlobRoutes(app, config.JWT_HS256_SECRET);
  }
  await registerVaultIntakeRoutes(app, config, db, { stepUp: services.stepUp, biometrics });
  await registerMobileFeatureRoutes(app, config, db);
  await registerNextMobileFeatureRoutes(app, config, db);
  await registerVertical2Routes(app, config, {
    vertical2: services.vertical2,
    ai: services.ai,
    entitlements: services.entitlements
  });
  await registerMilestone3Routes(app, config, {
    deviceFederation: services.deviceFederation,
    transparency: services.keyTransparency,
    turn: services.turnRegions,
    attachments: services.attachmentCdn,
    enterpriseIdentity: services.enterpriseIdentityV2,
    billingReconciliation: services.billingReconciliation,
    mlsGroups: services.mlsGroups,
    pushV2: services.pushV2,
    emergencyEscalation: services.emergencyEscalation,
    canaryReleases: services.canaryReleases
  }, hub);
  await registerGaHardeningRoutes(app, config, {
    gates: services.gaGates,
    privacyRights: services.privacyRights,
    support: services.supportOperations,
    residency: services.dataResidency,
    securityAssessment: services.securityAssessment,
    retentionArchive: services.retentionArchive,
    incidentResponse: services.incidentResponse,
    productionKillSwitches: services.productionKillSwitches,
    gaRollout: services.gaRollout,
    diagnosticRedaction: services.diagnosticRedaction
  });
  await registerMultiAccountRoutes(app, config, {
    multiAccount: services.multiAccount,
    accountSwitch: services.accountSwitch,
    pushIsolation: services.accountPushIsolation
  });
  await registerAccountIdentifierRoutes(app, config, db, services.authChallenges);
  await registerCountryLinqaRoutes(app, config, db, services.countryLinqa);
  await registerCountryLinqaGoLiveRoutes(app, config, db);
  await registerCountryLinqaFinalRoutes(app, config, db);
  await registerCountryLinqaEngineRoutes(app, config, db, metrics);
  await registerCountryLinqaPlanRoutes(app, config, db);
  await registerCountryLinqaAdminRoutes(app, config, db);
  await registerCountryLinqaSecurityRoutes(app, config, db, services.countryReverification);
  await registerLinqaSendRoutes(app, config, db, undefined, biometrics);
  await registerOperationsRoutes(app, config, db, hub);

  // Home (Production Closure Pack v1.0 + Implementation Completion Pack
  // v1.1). Registered before mobile-hub because `/v1/mobile/home` moved here
  // from `routes/mobile-hub.ts`: Fastify rejects a duplicate route, so the
  // aggregated production feed is now the single owner of that path and
  // mobile-hub keeps only its legacy `/v1/mobile-hub/home-feed` alias.
  const home = createHomeModule({
    db,
    redisUrl: config.REDIS_URL,
    metrics,
    onRedisError: (error) => {
      app.log.warn({ err: error }, "Home Redis unavailable; PostgreSQL cache tier active");
    }
  });
  app.addHook("onClose", async () => {
    await home.close();
  });
  await registerHomeRoutes(app, config, db, home);
  await registerHomeAdminRoutes(app, config, db, home);

  await registerRealtime(app, config, db, hub);
  await registerSignaling(app, config, db, services.signaling, hub);
  await registerMobileHubRoutes(app, config, db, hub);

  // Cross-node chat fan-out. Without Redis this is a no-op and delivery falls
  // back to in-process sockets plus durable replay, which is correct on a
  // single node and degraded-but-working on several.
  const chatBus = createChatBus(config.REDIS_URL, (error) =>
    app.log.warn({ err: error }, "chat redis bus unavailable; using in-process fan-out")
  );
  startChatBusSubscriber(hub, chatBus);
  await registerChatRoutes(app, config, db);
  await registerChatV2Routes(app, config, db, hub, chatBus);
  await registerThreadAttachmentRoutes(app, config, db);
  await registerChatFeatureRoutes(app, config, db);
  await registerLiveScreenRoutes(app, config, db);
  app.addHook("onClose", async () => {
    await chatBus.close();
  });
}
