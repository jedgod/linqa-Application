/**
 * Adapts linqa-core's React Native binding to what call encryption needs.
 *
 * linqa-core already does X25519 + ML-KEM-768 hybrid sealing, XChaCha20-Poly1305
 * and Ed25519 for chats. Calls need the same three operations, applied to
 * call keys instead of messages. Point the three functions below at the
 * matching linqa-core calls (UniFFI/JSI/native module), whatever they're named.
 *
 * Byte arrays cross the bridge as base64 here because that works with every
 * binding style. If yours takes ArrayBuffer/Uint8Array directly, drop the b64.
 */
import { b64d, b64e } from '../crypto/bytes';
import type { DevicePublicKeys, LinqaCoreBinding } from '../crypto/linqaCore';

export interface LinqaCoreNative {
  /** Hybrid-seal to a device. Must bind `aad` into the AEAD. Returns base64. */
  sealToDevice(args: {
    x25519: string;
    mlkem768: string;
    plaintext: string;
    aad: string;
  }): Promise<string>;
  /** Open with THIS device's private keys (never exposed to JS). Returns base64 plaintext. */
  openSealed(args: { sealed: string; aad: string }): Promise<string>;
  /** Ed25519 sign with THIS device's identity key. Returns base64 signature (64 bytes). */
  signWithIdentity(args: { message: string }): Promise<string>;
}

export function linqaCoreBinding(native: LinqaCoreNative): LinqaCoreBinding {
  return {
    async seal(recipient: DevicePublicKeys, plaintext: Uint8Array, aad: Uint8Array) {
      return b64d(
        await native.sealToDevice({
          x25519: b64e(recipient.x25519),
          mlkem768: b64e(recipient.mlkem768),
          plaintext: b64e(plaintext),
          aad: b64e(aad),
        }),
      );
    },
    async open(sealed: Uint8Array, aad: Uint8Array) {
      return b64d(await native.openSealed({ sealed: b64e(sealed), aad: b64e(aad) }));
    },
    async sign(message: Uint8Array) {
      const sig = b64d(await native.signWithIdentity({ message: b64e(message) }));
      if (sig.length !== 64) throw new Error('linqa-core returned a bad signature length');
      return sig;
    },
  };
}
