use serde::{Deserialize, Serialize};
use serde_big_array::BigArray;
use thiserror::Error;

use super::hybrid_ciphertext_v1::{HybridCiphertextV1, WireError};

const MAGIC: [u8; 4] = *b"LQEV";
const VERSION: u16 = 1;
const MAX_ENVELOPE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum EnvelopeError {
    #[error("wire error: {0}")]
    Wire(#[from] WireError),
    #[error("invalid envelope")]
    Invalid,
    #[error("unsupported version")]
    UnsupportedVersion,
    #[error("envelope expired")]
    Expired,
    #[error("serialization failed")]
    Serialization,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProtocolEnvelopeV1 {
    magic: [u8; 4],
    version: u16,
    pub message_id: [u8; 16],
    pub recipient_device_hash: [u8; 32],
    pub sent_at_unix: u64,
    pub expires_at_unix: u64,
    pub replay_nonce: [u8; 32],
    pub aead_nonce: [u8; 12],
    pub hybrid_ciphertext: HybridCiphertextV1,
    pub sender_credential: Vec<u8>,
    pub encrypted_payload: Vec<u8>,
    #[serde(with = "BigArray")]
    pub sender_signature: [u8; 64],
}

impl ProtocolEnvelopeV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        message_id: [u8; 16],
        recipient_device_hash: [u8; 32],
        sent_at_unix: u64,
        expires_at_unix: u64,
        replay_nonce: [u8; 32],
        aead_nonce: [u8; 12],
        hybrid_ciphertext: HybridCiphertextV1,
        sender_credential: Vec<u8>,
        encrypted_payload: Vec<u8>,
        sender_signature: [u8; 64],
    ) -> Result<Self, EnvelopeError> {
        let envelope = Self {
            magic: MAGIC,
            version: VERSION,
            message_id,
            recipient_device_hash,
            sent_at_unix,
            expires_at_unix,
            replay_nonce,
            aead_nonce,
            hybrid_ciphertext,
            sender_credential,
            encrypted_payload,
            sender_signature,
        };
        envelope.validate()?;
        Ok(envelope)
    }

    pub fn encode(&self) -> Result<Vec<u8>, EnvelopeError> {
        self.validate()?;
        let bytes = bincode::serde::encode_to_vec(self, wire_config())
            .map_err(|_| EnvelopeError::Serialization)?;
        if bytes.len() > MAX_ENVELOPE_BYTES {
            return Err(EnvelopeError::Invalid);
        }
        Ok(bytes)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, EnvelopeError> {
        if bytes.len() > MAX_ENVELOPE_BYTES {
            return Err(EnvelopeError::Invalid);
        }
        let (value, consumed): (Self, usize) =
            bincode::serde::decode_from_slice(bytes, wire_config())
                .map_err(|_| EnvelopeError::Serialization)?;
        if consumed != bytes.len() {
            return Err(EnvelopeError::Invalid);
        }
        value.validate()?;
        Ok(value)
    }

    pub fn validate_at(&self, now_unix: u64) -> Result<(), EnvelopeError> {
        self.validate()?;
        if now_unix > self.expires_at_unix {
            return Err(EnvelopeError::Expired);
        }
        Ok(())
    }

    fn validate(&self) -> Result<(), EnvelopeError> {
        if self.magic != MAGIC || self.version != VERSION {
            return Err(EnvelopeError::UnsupportedVersion);
        }
        if self.expires_at_unix <= self.sent_at_unix {
            return Err(EnvelopeError::Invalid);
        }
        self.hybrid_ciphertext.encode()?;
        Ok(())
    }
}

fn wire_config() -> impl bincode::config::Config {
    bincode::config::standard()
        .with_fixed_int_encoding()
        .with_big_endian()
}
