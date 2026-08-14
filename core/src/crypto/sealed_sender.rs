//! Real sealed-sender: the relay sees only a delivery token, never the
//! sender's identity. The recipient recovers the true sender identity,
//! credential, and payload after opening the envelope with their own
//! hybrid (X25519 + ML-KEM-768) secret key.
//!
//! This is a port of `implementations/01_hybrid_crypto/sealed_sender.rs`
//! wired to the real `crypto::hybrid_kem` (instead of `SimulatedPqKem`),
//! using the real `protocol::hybrid_ciphertext_v1` wire format instead of
//! ad-hoc framing, and replacing the delivery token's placeholder
//! all-zero "authorization" field with a real keyed HMAC-SHA256.

use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use hmac::{Hmac, Mac};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop};

use super::hybrid_kem::{decapsulate, encapsulate, HybridPublicKey, HybridSecretKey};
use crate::protocol::hybrid_ciphertext_v1::HybridCiphertextV1;

type HmacSha256 = Hmac<Sha256>;

/// Credential that proves to the *recipient* who the sender is.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SealedSenderCredential {
    GroupMembership {
        identity: String,
        device: String,
        group_id: Vec<u8>,
        epoch: u64,
        proof: Vec<u8>,
    },
    Direct {
        identity: String,
        device: String,
        recipient: String,
        nonce: [u8; 32],
        signature: Vec<u8>,
    },
    Anonymous {
        token: Vec<u8>,
        expiry: u64,
    },
}

/// Short-lived token visible to the relay (authorizes delivery only).
#[derive(Debug, Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct DeliveryToken {
    pub recipient_hint: Vec<u8>,
    pub expiry: u64,
    pub nonce: [u8; 16],
    pub authorization: Vec<u8>,
}

/// The envelope that travels through the relay.
#[derive(Clone, Serialize, Deserialize)]
pub struct SealedSenderEnvelope {
    /// Visible to relay.
    pub delivery_token: DeliveryToken,
    /// Encrypted: sender_identity || credential || payload.
    pub ciphertext: Vec<u8>,
    /// Hybrid KEM ciphertext, wire-encoded via `HybridCiphertextV1`.
    pub kem_ciphertext: Vec<u8>,
}

#[derive(Zeroize, ZeroizeOnDrop)]
struct EnvelopeKey([u8; 32]);

/// Seal a message so only the intended recipient can open it.
pub fn seal(
    sender_identity: &str,
    credential: &SealedSenderCredential,
    payload: &[u8],
    recipient_pk: &HybridPublicKey,
    delivery_token: DeliveryToken,
) -> Result<SealedSenderEnvelope, String> {
    let (ct, shared) = encapsulate(recipient_pk)?;
    let key = EnvelopeKey(shared.0);

    let inner = InnerPlaintext {
        sender_identity: sender_identity.to_string(),
        credential: credential.clone(),
        payload: payload.to_vec(),
    };
    let plaintext = serde_json::to_vec(&inner).map_err(|e| e.to_string())?;

    let cipher = ChaCha20Poly1305::new_from_slice(&key.0).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let mut ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|_| "AEAD encryption failed".to_string())?;

    let mut full_ct = nonce_bytes.to_vec();
    full_ct.append(&mut ciphertext);

    let kem_ciphertext = HybridCiphertextV1::from_parts(ct.classical, ct.pq)
        .map_err(|e| e.to_string())?
        .encode()
        .map_err(|e| e.to_string())?;

    Ok(SealedSenderEnvelope {
        delivery_token,
        ciphertext: full_ct,
        kem_ciphertext,
    })
}

/// Open a sealed-sender envelope (recipient side).
pub fn open(
    envelope: &SealedSenderEnvelope,
    recipient_sk: &HybridSecretKey,
) -> Result<(String, SealedSenderCredential, Vec<u8>), String> {
    let wire = HybridCiphertextV1::decode(&envelope.kem_ciphertext).map_err(|e| e.to_string())?;
    let ct = super::hybrid_kem::HybridCiphertext {
        classical: wire.ephemeral_x25519_public,
        pq: wire.ml_kem_ciphertext,
    };
    let shared = decapsulate(recipient_sk, &ct)?;
    let key = EnvelopeKey(shared.0);

    if envelope.ciphertext.len() < 12 {
        return Err("ciphertext too short".into());
    }
    let (nonce_bytes, ct_body) = envelope.ciphertext.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher = ChaCha20Poly1305::new_from_slice(&key.0).map_err(|e| e.to_string())?;
    let plaintext = cipher
        .decrypt(nonce, ct_body)
        .map_err(|_| "AEAD decryption failed — wrong key or tampered envelope".to_string())?;

    let inner: InnerPlaintext = serde_json::from_slice(&plaintext).map_err(|e| e.to_string())?;

    Ok((inner.sender_identity, inner.credential, inner.payload))
}

#[derive(Serialize, Deserialize)]
struct InnerPlaintext {
    sender_identity: String,
    credential: SealedSenderCredential,
    payload: Vec<u8>,
}

fn delivery_token_mac_input(recipient_hint: &[u8], expiry: u64, nonce: &[u8; 16]) -> Vec<u8> {
    let mut input = Vec::with_capacity(recipient_hint.len() + 8 + 16);
    input.extend_from_slice(recipient_hint);
    input.extend_from_slice(&expiry.to_be_bytes());
    input.extend_from_slice(nonce);
    input
}

/// Create a delivery token authorized with a real keyed HMAC-SHA256, rather
/// than the all-zero placeholder this replaces. `authorization_key` is a
/// symmetric key shared between the sender and whatever verifies delivery
/// (e.g. the relay), established out of band.
pub fn make_delivery_token(
    recipient_hint: &[u8],
    ttl_secs: u64,
    authorization_key: &[u8; 32],
) -> DeliveryToken {
    let mut nonce = [0u8; 16];
    OsRng.fill_bytes(&mut nonce);
    let expiry = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() + ttl_secs)
        .unwrap_or(0);

    let mut mac = <HmacSha256 as Mac>::new_from_slice(authorization_key)
        .expect("HMAC-SHA256 accepts any key length");
    mac.update(&delivery_token_mac_input(recipient_hint, expiry, &nonce));
    let authorization = mac.finalize().into_bytes().to_vec();

    DeliveryToken {
        recipient_hint: recipient_hint.to_vec(),
        expiry,
        nonce,
        authorization,
    }
}

/// Verify a delivery token's authorization MAC. Returns `false` for a
/// tampered token, a token authorized under a different key, or an expired
/// token.
pub fn verify_delivery_token(token: &DeliveryToken, authorization_key: &[u8; 32]) -> bool {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(u64::MAX);
    if now > token.expiry {
        return false;
    }

    let mut mac = match <HmacSha256 as Mac>::new_from_slice(authorization_key) {
        Ok(mac) => mac,
        Err(_) => return false,
    };
    mac.update(&delivery_token_mac_input(
        &token.recipient_hint,
        token.expiry,
        &token.nonce,
    ));
    mac.verify_slice(&token.authorization).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::hybrid_kem::generate_keypair;

    #[test]
    fn seal_and_open_round_trip_recovers_sender_identity_and_payload() {
        let (recipient_public, recipient_secret) = generate_keypair();
        let token = make_delivery_token(b"recipient-hint", 300, &[7u8; 32]);

        let envelope = seal(
            "alice",
            &SealedSenderCredential::Anonymous {
                token: vec![1, 2, 3],
                expiry: 9_999_999_999,
            },
            b"hello sealed world",
            &recipient_public,
            token,
        )
        .unwrap();

        let (sender_identity, _credential, payload) = open(&envelope, &recipient_secret).unwrap();

        assert_eq!(sender_identity, "alice");
        assert_eq!(payload, b"hello sealed world");
    }

    #[test]
    fn wrong_recipient_cannot_open_the_envelope() {
        let (recipient_public, _) = generate_keypair();
        let (_, wrong_secret) = generate_keypair();
        let token = make_delivery_token(b"hint", 300, &[1u8; 32]);

        let envelope = seal(
            "alice",
            &SealedSenderCredential::Anonymous {
                token: vec![],
                expiry: 0,
            },
            b"secret",
            &recipient_public,
            token,
        )
        .unwrap();

        assert!(open(&envelope, &wrong_secret).is_err());
    }

    #[test]
    fn delivery_token_authorization_is_a_real_verifiable_mac_not_a_placeholder() {
        let key = [42u8; 32];
        let token = make_delivery_token(b"recipient-hint", 300, &key);

        assert_ne!(token.authorization, vec![0u8; 32]);
        assert!(verify_delivery_token(&token, &key));
        assert!(!verify_delivery_token(&token, &[0u8; 32]));
    }

    #[test]
    fn tampered_delivery_token_fails_verification() {
        let key = [42u8; 32];
        let mut token = make_delivery_token(b"recipient-hint", 300, &key);
        token.recipient_hint = b"different-hint".to_vec();

        assert!(!verify_delivery_token(&token, &key));
    }

    #[test]
    fn expired_delivery_token_fails_verification() {
        let key = [42u8; 32];
        let mut token = make_delivery_token(b"recipient-hint", 300, &key);
        token.expiry = 0;

        assert!(!verify_delivery_token(&token, &key));
    }
}
