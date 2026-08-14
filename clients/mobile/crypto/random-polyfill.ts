import * as Crypto from "expo-crypto";

/**
 * Hermes/React Native has no global.crypto by default (confirmed by the
 * Math.random() fallback InstallationIdentity.ts already carries for its
 * non-cryptographic installation id). @noble/curves refuses to generate key
 * material without a real crypto.getRandomValues, which is exactly the
 * right behavior for Ed25519/X25519 device keys — so this polyfills it with
 * expo-crypto's native, OS-backed CSPRNG instead of a permissive shim.
 * Must be imported before any device-key generation runs; imported first in
 * app/_layout.tsx so it always executes before anything else does.
 */
const globalWithCrypto = globalThis as unknown as { crypto?: { getRandomValues?: typeof Crypto.getRandomValues } };

if (!globalWithCrypto.crypto || typeof globalWithCrypto.crypto.getRandomValues !== "function") {
  globalWithCrypto.crypto = { getRandomValues: Crypto.getRandomValues };
}
