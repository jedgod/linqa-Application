//! Working Sealed-Sender implementation for Linqa
//!
//! The relay sees only a delivery token.
//! The recipient recovers the true sender identity + credential + payload
//! after opening the envelope with their private key material.

use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use super::hybrid_kem::{HybridPublicKey, HybridSecretKey, HybridKem, PqcStrength, SimulatedPqKem};

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
    /// Visible to relay
    pub delivery_token: DeliveryToken,
    /// Encrypted: sender_identity || credential || payload
    pub ciphertext: Vec<u8>,
    /// Ephemeral public key used for the envelope KEM (hybrid)
    pub eph_public: Vec<u8>,
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
    // 1. Hybrid KEM → envelope key
    let (ct, shared) = HybridKem::<SimulatedPqKem>::encapsulate(recipient_pk, PqcStrength::Standard)
        .map_err(|e| e.to_string())?;

    let mut key = EnvelopeKey(*shared.as_bytes());

    // 2. Serialize inner plaintext
    let inner = InnerPlaintext {
        sender_identity: sender_identity.to_string(),
        credential: credential.clone(),
        payload: payload.to_vec(),
    };
    let plaintext = serde_json::to_vec(&inner).map_err(|e| e.to_string())?;

    // 3. AEAD encrypt
    let cipher = ChaCha20Poly1305::new_from_slice(&key.0)
        .map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let mut ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|_| "AEAD encryption failed".to_string())?;

    // Prepend nonce for the recipient
    let mut full_ct = nonce_bytes.to_vec();
    full_ct.append(&mut ciphertext);

    // Serialize the hybrid ciphertext for transport
    let eph_public = bincode_serialize_hybrid_ct(&ct)?;

    Ok(SealedSenderEnvelope {
        delivery_token,
        ciphertext: full_ct,
        eph_public,
    })
}

/// Open a sealed-sender envelope (recipient side).
pub fn open(
    envelope: &SealedSenderEnvelope,
    recipient_sk: &HybridSecretKey,
) -> Result<(String, SealedSenderCredential, Vec<u8>), String> {
    let ct = bincode_deserialize_hybrid_ct(&envelope.eph_public)?;
    let shared = HybridKem::<SimulatedPqKem>::decapsulate(recipient_sk, &ct, PqcStrength::Standard)
        .map_err(|e| e.to_string())?;

    let key = EnvelopeKey(*shared.as_bytes());

    if envelope.ciphertext.len() < 12 {
        return Err("ciphertext too short".into());
    }
    let (nonce_bytes, ct_body) = envelope.ciphertext.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher = ChaCha20Poly1305::new_from_slice(&key.0)
        .map_err(|e| e.to_string())?;
    let plaintext = cipher
        .decrypt(nonce, ct_body)
        .map_err(|_| "AEAD decryption failed — wrong key or tampered envelope".to_string())?;

    let inner: InnerPlaintext = serde_json::from_slice(&plaintext)
        .map_err(|e| e.to_string())?;

    Ok((inner.sender_identity, inner.credential, inner.payload))
}

#[derive(Serialize, Deserialize)]
struct InnerPlaintext {
    sender_identity: String,
    credential: SealedSenderCredential,
    payload: Vec<u8>,
}

// Minimal serialization helpers (replace with proper bincode/serde in production)
fn bincode_serialize_hybrid_ct(ct: &super::hybrid_kem::HybridCiphertext) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(32 + 4 + ct.pq.len());
    out.extend_from_slice(&ct.classical);
    out.extend_from_slice(&(ct.pq.len() as u32).to_le_bytes());
    out.extend_from_slice(&ct.pq);
    Ok(out)
}

fn bincode_deserialize_hybrid_ct(data: &[u8]) -> Result<super::hybrid_kem::HybridCiphertext, String> {
    if data.len() < 36 {
        return Err("invalid hybrid ciphertext".into());
    }
    let mut classical = [0u8; 32];
    classical.copy_from_slice(&data[..32]);
    let pq_len = u32::from_le_bytes(data[32..36].try_into().unwrap()) as usize;
    if data.len() < 36 + pq_len {
        return Err("truncated hybrid ciphertext".into());
    }
    Ok(super::hybrid_kem::HybridCiphertext {
        classical,
        pq: data[36..36 + pq_len].to_vec(),
    })
}

/// Helper to create a basic delivery token (caller supplies real authorization later).
pub fn make_delivery_token(recipient_hint: &[u8], ttl_secs: u64) -> DeliveryToken {
    let mut nonce = [0u8; 16];
    OsRng.fill_bytes(&mut nonce);
    let expiry = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() + ttl_secs)
        .unwrap_or(0);
    DeliveryToken {
        recipient_hint: recipient_hint.to_vec(),
        expiry,
        nonce,
        authorization: vec![0u8; 32], // placeholder MAC
    }
}
