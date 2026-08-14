use crate::{
    crypto::hybrid_kem::{self, HybridPublicKey, HybridSecretKey},
    error::{LinqaError, Result},
    identity::DeviceSecrets,
    replay::ReplayCache,
};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use ed25519_dalek::{Signature, Signer, Verifier, VerifyingKey};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_big_array::BigArray;
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

const DOMAIN: &[u8] = b"linqa:message-envelope:v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvelopeHeader {
    pub version: u16,
    pub message_id: String,
    pub sender_user_id: String,
    pub sender_device_id: String,
    pub recipient_user_id: String,
    pub recipient_device_id: String,
    pub created_at_unix: i64,
    pub expires_at_unix: i64,
    pub ephemeral_public_key: [u8; 32],
    /// ML-KEM-768 ciphertext encapsulated to the recipient's PQ public key.
    pub ml_kem_ciphertext: Vec<u8>,
    pub nonce: [u8; 24],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageEnvelope {
    pub header: EnvelopeHeader,
    pub ciphertext: Vec<u8>,
    #[serde(with = "BigArray")]
    pub sender_signature: [u8; 64],
}

fn aad(header: &EnvelopeHeader) -> Result<Vec<u8>> {
    postcard::to_allocvec(header).map_err(|_| LinqaError::SerializationFailure)
}

fn derive_key(shared_secret: &[u8; 32], header: &EnvelopeHeader) -> Result<[u8; 32]> {
    let salt: [u8; 32] = Sha256::digest(aad(header)?).into();
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared_secret);
    let mut key = [0u8; 32];
    hk.expand(DOMAIN, &mut key)
        .map_err(|_| LinqaError::CryptoFailure)?;
    Ok(key)
}

fn signature_payload(header: &EnvelopeHeader, ciphertext: &[u8]) -> Result<Vec<u8>> {
    let mut payload = aad(header)?;
    payload.extend_from_slice(ciphertext);
    Ok(payload)
}

#[allow(clippy::too_many_arguments)]
pub fn encrypt(
    sender: &DeviceSecrets,
    recipient_encryption_public_key: [u8; 32],
    recipient_pq_encryption_public_key: &[u8],
    sender_user_id: &str,
    sender_device_id: &str,
    recipient_user_id: &str,
    recipient_device_id: &str,
    message_id: &str,
    plaintext: &[u8],
    created_at_unix: i64,
    expires_at_unix: i64,
) -> Result<MessageEnvelope> {
    if plaintext.is_empty() {
        return Err(LinqaError::InvalidInput("plaintext is empty"));
    }
    if expires_at_unix <= created_at_unix {
        return Err(LinqaError::ValidationFailed("invalid envelope lifetime"));
    }

    let recipient_public = HybridPublicKey {
        classical: recipient_encryption_public_key,
        pq: recipient_pq_encryption_public_key.to_vec(),
    };
    let (kem_ciphertext, mut shared) =
        hybrid_kem::encapsulate(&recipient_public).map_err(|_| LinqaError::CryptoFailure)?;

    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut nonce);

    let header = EnvelopeHeader {
        version: 1,
        message_id: message_id.to_owned(),
        sender_user_id: sender_user_id.to_owned(),
        sender_device_id: sender_device_id.to_owned(),
        recipient_user_id: recipient_user_id.to_owned(),
        recipient_device_id: recipient_device_id.to_owned(),
        created_at_unix,
        expires_at_unix,
        ephemeral_public_key: kem_ciphertext.classical,
        ml_kem_ciphertext: kem_ciphertext.pq,
        nonce,
    };

    let mut key = derive_key(&shared.0, &header)?;
    shared.0.zeroize();

    let cipher = XChaCha20Poly1305::new((&key).into());
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&header.nonce),
            Payload {
                msg: plaintext,
                aad: &aad(&header)?,
            },
        )
        .map_err(|_| LinqaError::CryptoFailure)?;
    key.zeroize();

    let signature = sender
        .signing_key()
        .sign(&signature_payload(&header, &ciphertext)?)
        .to_bytes();

    Ok(MessageEnvelope {
        header,
        ciphertext,
        sender_signature: signature,
    })
}

pub fn decrypt(
    recipient: &DeviceSecrets,
    expected_recipient_device_id: &str,
    sender_signing_public_key: [u8; 32],
    envelope: &MessageEnvelope,
    now_unix: i64,
    replay_cache: &mut ReplayCache,
) -> Result<Vec<u8>> {
    if envelope.header.version != 1 {
        return Err(LinqaError::ValidationFailed("unsupported envelope version"));
    }
    if envelope.header.recipient_device_id != expected_recipient_device_id {
        return Err(LinqaError::AuthenticationFailed);
    }
    if now_unix > envelope.header.expires_at_unix {
        return Err(LinqaError::Expired);
    }

    let sender_key = VerifyingKey::from_bytes(&sender_signing_public_key)
        .map_err(|_| LinqaError::ValidationFailed("invalid sender key"))?;
    sender_key
        .verify(
            &signature_payload(&envelope.header, &envelope.ciphertext)?,
            &Signature::from_bytes(&envelope.sender_signature),
        )
        .map_err(|_| LinqaError::AuthenticationFailed)?;

    replay_cache.check_and_insert(&envelope.header.message_id)?;

    let recipient_secret = HybridSecretKey {
        classical: recipient.encryption_secret().to_bytes(),
        pq: recipient.pq_encryption_secret().to_vec(),
    };
    let kem_ciphertext = hybrid_kem::HybridCiphertext {
        classical: envelope.header.ephemeral_public_key,
        pq: envelope.header.ml_kem_ciphertext.clone(),
    };
    let mut shared = hybrid_kem::decapsulate(&recipient_secret, &kem_ciphertext)
        .map_err(|_| LinqaError::CryptoFailure)?;
    let mut key = derive_key(&shared.0, &envelope.header)?;
    shared.0.zeroize();

    let cipher = XChaCha20Poly1305::new((&key).into());
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(&envelope.header.nonce),
            Payload {
                msg: &envelope.ciphertext,
                aad: &aad(&envelope.header)?,
            },
        )
        .map_err(|_| LinqaError::AuthenticationFailed)?;
    key.zeroize();

    Ok(plaintext)
}
