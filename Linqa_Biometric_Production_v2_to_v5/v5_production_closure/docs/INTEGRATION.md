# Linqa repo-native wiring checklist

## Server
Mount biometric routes behind the existing Linqa authenticated-session middleware. Build `Principal` only from server-authenticated context. Never trust userId/deviceId/sessionId from request JSON.

## Device trust
Adapt to the current trusted installation/device repository. `revoked`, `compromised`, or insufficient trust must deny enrollment/challenge for protected purposes.

## LinqaVault
Use biometric step-up for Private Vault unlock/open, sensitive download/share, permanent delete, security settings, and Vault → Social export where policy requires it. The existing Vault policy engine remains authoritative.

## LinqaSend
Create the challenge from a server-loaded transfer snapshot. The mobile client must not supply the authoritative amount/recipient/quote used for hashing. Consume the grant in the same DB transaction that transitions the transfer authorization state.

## Mobile
Use the supplied native modules as the starting point, but adapt package/module registration to the current Expo/React Native architecture. Physical-device certification is mandatory; simulator success is insufficient.

## Attestation
`AttestationVerifier` is intentionally provider-neutral. Production must connect to the chosen iOS/Android device/app attestation mechanisms and validate evidence server-side. Unsupported or unverifiable attestation must follow explicit product policy; high-risk LinqaSend actions should fail closed.

## Recovery
Lost device/account recovery must revoke credentials and increment the user biometric security epoch. Re-enrollment occurs only after the normal Linqa recovery and trusted-device process completes.
