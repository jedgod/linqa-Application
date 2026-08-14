use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAGIC: [u8; 4] = *b"LQHK";
const VERSION: u16 = 1;
const MAX_WIRE_BYTES: usize = 8 * 1024;
const MAX_PQ_CIPHERTEXT_BYTES: usize = 4096;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum WireError {
    #[error("unsupported wire version")]
    UnsupportedVersion,
    #[error("invalid wire magic")]
    InvalidMagic,
    #[error("invalid hybrid ciphertext")]
    InvalidCiphertext,
    #[error("serialization failed")]
    Serialization,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct HybridCiphertextV1 {
    magic: [u8; 4],
    version: u16,
    pub ephemeral_x25519_public: [u8; 32],
    pub ml_kem_ciphertext: Vec<u8>,
}

impl HybridCiphertextV1 {
    pub fn from_parts(
        ephemeral_x25519_public: [u8; 32],
        ml_kem_ciphertext: Vec<u8>,
    ) -> Result<Self, WireError> {
        validate_ciphertext(&ml_kem_ciphertext)?;
        Ok(Self {
            magic: MAGIC,
            version: VERSION,
            ephemeral_x25519_public,
            ml_kem_ciphertext,
        })
    }

    pub fn encode(&self) -> Result<Vec<u8>, WireError> {
        self.validate()?;
        bincode::serde::encode_to_vec(self, wire_config()).map_err(|_| WireError::Serialization)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, WireError> {
        if bytes.len() > MAX_WIRE_BYTES {
            return Err(WireError::InvalidCiphertext);
        }
        let (value, consumed): (Self, usize) =
            bincode::serde::decode_from_slice(bytes, wire_config())
                .map_err(|_| WireError::Serialization)?;
        if consumed != bytes.len() {
            return Err(WireError::InvalidCiphertext);
        }
        value.validate()?;
        Ok(value)
    }

    fn validate(&self) -> Result<(), WireError> {
        if self.magic != MAGIC {
            return Err(WireError::InvalidMagic);
        }
        if self.version != VERSION {
            return Err(WireError::UnsupportedVersion);
        }
        validate_ciphertext(&self.ml_kem_ciphertext)
    }
}

fn validate_ciphertext(ciphertext: &[u8]) -> Result<(), WireError> {
    if ciphertext.is_empty() || ciphertext.len() > MAX_PQ_CIPHERTEXT_BYTES {
        return Err(WireError::InvalidCiphertext);
    }
    Ok(())
}

fn wire_config() -> impl bincode::config::Config {
    bincode::config::standard()
        .with_fixed_int_encoding()
        .with_big_endian()
}
