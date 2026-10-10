# LinqaVault and LinqaSend biometric authorization

Implemented from `linqa_biometric_pack` and `Linqa_Biometric_Production_v2_to_v5`, adapting the v5 protocol to the existing Fastify, PostgreSQL and Expo application. The supplied folders remain reference inputs. Their native examples and placeholder tests were replaced with an executable local Expo module and application tests.

## Application behavior

- Mobile Private Vault requests a server challenge, signs it with a biometric-protected device key, consumes a one-use server grant, and receives a five-minute unlock session. Private metadata is fetched only after authorization. The screen clears metadata and locks on background, navigation away, expiry and account changes.
- Regular Vault listing and Home recent items exclude `IDENTITY` and `RECOVERY` records. Private listing and private download requests require a valid device-, installation-, session- and account-bound unlock token. Tokens are held in memory; the old shared SecureStore unlock marker is removed.
- LinqaSend signs a server-derived payment challenge with the same native key. The server binds authorization to the transfer, transaction hash, current quote, recipient payout details and funding method snapshots. One-use grants and payment authorizations are consumed in database transactions. Changes to those snapshots invalidate authorization.
- Production rejects the previous software-key payment authorization. The development fallback remains for existing sandbox flows. Payment risk controls, funding readiness, real-money gates and provider checks still apply.
- Vault Security Center can enroll and revoke biometric credentials. Global revocation increments the account security epoch. Every biometric request rechecks active device, session and trusted installation membership. A recovery-completion security event atomically increments the epoch and revokes credentials and Vault sessions through the migration trigger.
- The browser displays the mobile unlock requirement for Private Vault. It has no native biometric signing bridge and cannot claim that a local PIN unlocked protected records.

Android uses a P-256 Android Keystore key, hardware checks and a strong biometric `CryptoObject` prompt for each signature. iOS uses a P-256 Secure Enclave key protected by `biometryCurrentSet` and device-only Keychain access. Enrollment changes invalidate native keys. No face images, fingerprints or biometric templates are uploaded.

## Server and native setup

1. Back up the target database and run the existing migration command from `server`: `npm.cmd run db:migrate`. Migration `048_biometric_authorization.sql` creates credentials, enrollment requests, challenges, grants, Vault sessions, chained audit events and the payment/recovery integration. This implementation task did not apply migrations to a deployed database.
2. Rebuild the native mobile application. The local module lives under `clients/mobile/modules/linqa-biometric` and Expo autolinking discovers it. Expo Go and an older installed binary do not contain the bridge and fail closed. iOS requires its native build and configured signing entitlements, including App Attest.
3. Set `BIOMETRIC_ATTESTATION_URL` and `BIOMETRIC_ATTESTATION_TOKEN` together. Production requires HTTPS and verified evidence; absent or rejected attestation prevents enrollment. Nonproduction permits a credential marked `NOT_SUPPORTED` for development only.
4. Test with the existing authenticated device session and a trusted installation. A token without UUID device/session claims cannot use the biometric endpoints.

## Attestation verifier contract

The configured endpoint receives the authenticated `principal`, `platform`, `publicKeySpkiBase64`, `publicKeyHash` (SHA-256 hex), enrollment `nonce` and native `evidence`. It must independently validate platform evidence, app identity, freshness, key binding and the accepted hardware/biometric policy. It returns `verified: true`, matching `publicKeyHash`, `nonce`, `userId`, `deviceId`, `installationId`, `sessionId`, and all of `biometricStrong`, `hardwareBacked`, `authPerUse` as true, plus a `provider` string. A caller's assertions are not evidence. No production verifier endpoint or credentials were supplied with the packs.

Android evidence contains the key attestation certificate chain and the server nonce as its attestation challenge. The verifier must validate chain roots/revocation, application identity and the key authorization extension, including hardware security level and biometric authentication requirements.

iOS evidence contains an App Attest key ID, attestation object and client-data hash. Recompute the hash over UTF-8 `LINQA-BIOMETRIC-ENROLL-V5`, followed by the decoded 32-byte enrollment nonce and the biometric public key SPKI. Validate Apple's attestation and app/environment identity. App Attest establishes app integrity and binds the submitted public key; it does **not** directly attest the separate Secure Enclave key's access-control flags. A production verifier must explicitly accept that trust model or deny iOS enrollment. The integration does not invent certification for those flags.

References: [Android biometric cryptographic authentication](https://developer.android.com/identity/sign-in/biometric-auth), [Apple Secure Enclave keys](https://developer.apple.com/documentation/Security/protecting-keys-with-the-secure-enclave), [Apple App Attest server validation](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server).

## Validation and limits

Verified server TypeScript build, web production build, mobile TypeScript check, Android native module compilation, biometric service/client tests and existing Vault/Send route and control tests. Tests cover signature rejection, replay, principal changes, purpose/resource/version binding, expiry, revocation, epoch changes, payment snapshot changes, unavailable signing, canceled prompts and account switching. Route tests reject unauthenticated requests, missing device claims and caller-supplied identity/resource hashes.

iOS compilation and physical iOS/Android biometric behavior remain unverified on this Windows host. PostgreSQL migration execution, concurrent database races, background prompt behavior, key invalidation, recovery completion and live attestation require environment/device validation before release. The supplied release evidence templates and placeholder tests are not production certification.

The implemented consumers are Private Vault unlock/list/download and transfer authorization. `VAULT_PRIVATE_OPEN` has a server resource-binding challenge definition, but the current Vault UI uses its five-minute unlock session. Other pack purposes (export/share/delete, cashout, add-payment-method and security changes) remain unconfigured and fail closed; they are not represented as implemented flows. The existing recovery review workflow records a decision rather than executing account recovery; any eventual recovery executor must insert `ACCOUNT_RECOVERY_COMPLETED` within its recovery transaction so the trigger runs.

Already issued object-storage download URLs retain their original expiry and cannot be revoked through the biometric session table. Audit records are hash-chained under the account lock, but no external immutable audit anchor or audit monitoring worker was added. Expired biometric records need an operational retention/cleanup policy. Biometric authorization does not constitute deployment, financial certification or payment-provider activation.
