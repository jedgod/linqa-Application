/**
 * A JavaScript LinqaCoreBinding that implements the same hybrid scheme with
 * audited @noble libraries:
 *
 *   ss1 = X25519(ephemeral, recipient.x25519)
 *   (ct, ss2) = ML-KEM-768.encapsulate(recipient.mlkem768)
 *   key = HKDF-SHA256(ikm = ss1 || ss2, salt = ephPub || ct, info = "linqa-call-seal-v1")
 *   sealed = 0x01 || ephPub(32) || ct(1088) || nonce(24) || XChaCha20-Poly1305(key, nonce, aad)
 *
 * Use it:
 *  - in tests (it's what the test suite runs against), and
 *  - in the app ONLY if linqa-core can't do seal/open/sign itself yet. It needs
 *    this device's private keys in JS memory, which linqa-core is built to avoid.
 *    The real path is a binding that calls linqa-core's own seal/open/sign.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { ed25519, x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';
import { ml_kem768 } from '@noble/post-quantum/ml-kem';
import { concat, utf8 } from './bytes';
import type { DevicePublicKeys, LinqaCoreBinding } from './linqaCore';

const INFO = utf8('linqa-call-seal-v1');
const CT_LEN = 1088;

export interface DeviceSecretKeys {
  x25519: Uint8Array;
  mlkem768: Uint8Array; // decapsulation key
  ed25519: Uint8Array; // 32-byte seed
}

export class JsCoreBinding implements LinqaCoreBinding {
  constructor(private readonly secrets: DeviceSecretKeys) {}

  async seal(recipient: DevicePublicKeys, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
    const eph = x25519.utils.randomPrivateKey();
    const ephPub = x25519.getPublicKey(eph);
    const ss1 = x25519.getSharedSecret(eph, recipient.x25519);
    const { cipherText, sharedSecret: ss2 } = ml_kem768.encapsulate(recipient.mlkem768);
    const key = hkdf(sha256, concat(ss1, ss2), concat(ephPub, cipherText), INFO, 32);
    const nonce = randomBytes(24);
    const body = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
    return concat(new Uint8Array([1]), ephPub, cipherText, nonce, body);
  }

  async open(sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
    if (sealed[0] !== 1 || sealed.length < 1 + 32 + CT_LEN + 24 + 16) throw new Error('bad-sealed');
    const ephPub = sealed.subarray(1, 33);
    const ct = sealed.subarray(33, 33 + CT_LEN);
    const nonce = sealed.subarray(33 + CT_LEN, 57 + CT_LEN);
    const body = sealed.subarray(57 + CT_LEN);
    const ss1 = x25519.getSharedSecret(this.secrets.x25519, ephPub);
    const ss2 = ml_kem768.decapsulate(ct, this.secrets.mlkem768);
    const key = hkdf(sha256, concat(ss1, ss2), concat(ephPub, ct), INFO, 32);
    return xchacha20poly1305(key, nonce, aad).decrypt(body);
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return ed25519.sign(message, this.secrets.ed25519);
  }
}

/** Fresh device keys. For tests and local development only. */
export function generateDeviceKeys(userId: string, deviceId: string) {
  const xs = x25519.utils.randomPrivateKey();
  const kem = ml_kem768.keygen();
  const es = ed25519.utils.randomPrivateKey();
  return {
    secrets: { x25519: xs, mlkem768: kem.secretKey, ed25519: es } as DeviceSecretKeys,
    publicKeys: {
      userId,
      deviceId,
      x25519: x25519.getPublicKey(xs),
      mlkem768: kem.publicKey,
      ed25519: ed25519.getPublicKey(es),
    } as DevicePublicKeys,
  };
}
