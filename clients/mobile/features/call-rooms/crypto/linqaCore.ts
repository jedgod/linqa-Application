/**
 * What call encryption needs from linqa-core, and what it needs from your key
 * directory. Private keys never leave linqa-core.
 *
 * Hook these to the linqa-core React Native binding (UniFFI / JSI / native module).
 */

/** A device's public keys, as published to Linqa's key directory. */
export interface DevicePublicKeys {
  userId: string;
  deviceId: string;
  x25519: Uint8Array; // 32 bytes
  mlkem768: Uint8Array; // 1184 bytes (ML-KEM-768 encapsulation key)
  ed25519: Uint8Array; // 32 bytes (identity signing key)
}

export interface LinqaCoreBinding {
  /**
   * Hybrid-seal `plaintext` to a device: X25519 + ML-KEM-768 shared secrets
   * -> KDF -> XChaCha20-Poly1305. `aad` must be bound into the AEAD.
   */
  seal(recipient: DevicePublicKeys, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  /** Open something sealed to THIS device with `seal`. Throws if it fails. */
  open(sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  /** Ed25519 signature with THIS device's identity key. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export interface KeyDirectory {
  /** Every active device of a user. Used to seal the call key for each one. */
  devices(userId: string): Promise<DevicePublicKeys[]>;
  /** One device's keys. Used to verify a sender's signature. */
  device(userId: string, deviceId: string): Promise<DevicePublicKeys | null>;
}
