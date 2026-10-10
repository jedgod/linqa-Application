# Certification gates

1. Face/biometric templates never leave OS biometric subsystem.
2. Server stores only public device signing keys, never biometric images/templates.
3. Enrollment requires authenticated session + trusted device.
4. Android uses BIOMETRIC_STRONG with CryptoObject-backed signing.
5. iOS key requires biometryCurrentSet and Secure Enclave when available.
6. Key invalidates after biometric-set changes.
7. Challenges are random, one-time and <=90 seconds.
8. Challenge is bound to user + device + purpose + resource hash.
9. Signature verification is cryptographic and fail-closed.
10. Grants are one-time, short-lived and purpose/resource bound.
11. Vault grant cannot authorize LinqaSend.
12. Transfer grant cannot authorize another transfer.
13. Amount/currency/recipient/quote are bound before payment authorization.
14. Transfer state update and grant consumption occur in one DB transaction.
15. Revoked/lost devices cannot create or use grants.
16. High-risk/compromised device requests are denied before biometric challenge.
17. Recovery cannot silently bypass step-up; use existing Linqa recovery/step-up policy.
18. All enrollment, verification, revocation and denied attempts are audited.
19. Rate-limit challenge creation and verification per account/device/IP.
20. Test replay, expiry, wrong device, wrong user, wrong resource, wrong purpose, altered amount,
    altered recipient, revoked key, biometric-set change and concurrent transfer authorization.
