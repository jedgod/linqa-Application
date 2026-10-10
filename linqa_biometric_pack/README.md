# Linqa Biometric Step-Up Pack v1.0

Production-oriented device biometric authentication for LinqaVault and LinqaSend.

## Security model

This implementation does **not** upload, store, or compare face images on the Linqa server. Face ID / Android biometric matching remains inside the operating system secure biometric subsystem. Linqa binds a hardware-backed device key to the authenticated user. A sensitive action creates a one-time backend challenge. The mobile app requires biometric authentication before the device key can sign that challenge. The backend verifies the signature and issues a short-lived, action-bound grant.

This provides biometric-gated authorization without creating a central facial-recognition database.

## Modules

- PostgreSQL schema for biometric credentials, challenges, grants and audit
- Express/TypeScript routes
- Ed25519 signature verification
- one-time challenges with expiry and replay protection
- device/user binding
- Vault purpose policies
- LinqaSend transaction-bound authorization
- transaction amount/currency/recipient binding
- risk and trusted-device adapter interfaces
- React Native native-module contract
- iOS Swift implementation using LocalAuthentication + Secure Enclave P-256
- Android Kotlin implementation using BiometricPrompt + Android Keystore P-256
- grant consumption middleware
- enrollment/revocation/recovery
- tests and certification checklist

## Critical rule

A biometric grant authorizes exactly the purpose and resource hash for which it was created. A LinqaSend grant for one transfer cannot authorize another transfer. A Vault unlock grant cannot authorize a payment.
