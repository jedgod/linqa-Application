# Mandatory Production Gap-Closure Integration Checklist

1. Production chat uses `ProductionMessagingCoordinator`; demo transport is never a live fallback.
2. The versioned Rust secure core produces WASM and native UniFFI artifacts.
3. Cryptographic operations remain in Rust; TypeScript/Kotlin/Swift only call the binding surface.
4. Client outboxes and device keys are encrypted and account-isolated.
5. Runtime probes cover database, Redis, secure core, transparency, relay, APNs, FCM, delivery, object storage, TURN, billing, KMS, and CountryLinqa risk.
6. Production startup refuses missing required providers or capabilities.
7. Production authentication uses composite SMS/email delivery.
8. Signed key packages are verified and appended to transparency storage.
9. Sensitive actions use action/user/device-bound, single-use step-up tokens.
10. Push and OTP providers are selected through the provider registry; legacy routes stay deprecated until migration completes.
11. Deployments use the checksum/advisory-lock migration runner.
12. The two-client E2E release assertion stays closed until its black-box environment is wired.
13. Mobile modules are hidden when workflow or runtime dependencies are not ready.
14. Clean-install and supported-version upgrade tests are release requirements.

