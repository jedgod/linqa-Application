use crate::{
    error::{LinqaError, Result},
    identity::DeviceSecrets,
};
use ed25519_dalek::{Signature, Signer, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_big_array::BigArray;
use sha2::{Digest, Sha256};

const DOMAIN: &[u8] = b"linqa:key-package:v1";
const CURRENT_VERSION: u16 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyPackage {
    pub version: u16,
    pub user_id: String,
    pub device_id: String,
    pub signing_public_key: [u8; 32],
    pub encryption_public_key: [u8; 32],
    /// ML-KEM-768 encapsulation (public) key, added in version 2 to enable
    /// real hybrid post-quantum key agreement.
    pub pq_encryption_public_key: Vec<u8>,
    pub created_at_unix: i64,
    pub expires_at_unix: i64,
    #[serde(with = "BigArray")]
    pub signature: [u8; 64],
}

impl KeyPackage {
    fn unsigned_hash(&self) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(DOMAIN);
        h.update(self.version.to_be_bytes());
        h.update(self.user_id.as_bytes());
        h.update(self.device_id.as_bytes());
        h.update(self.signing_public_key);
        h.update(self.encryption_public_key);
        h.update(&self.pq_encryption_public_key);
        h.update(self.created_at_unix.to_be_bytes());
        h.update(self.expires_at_unix.to_be_bytes());
        h.finalize().into()
    }

    pub fn package_hash(&self) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(self.unsigned_hash());
        h.update(self.signature);
        h.finalize().into()
    }
}

pub fn create_key_package(
    secrets: &DeviceSecrets,
    user_id: &str,
    device_id: &str,
    created_at_unix: i64,
    expires_at_unix: i64,
) -> Result<KeyPackage> {
    if user_id.trim().is_empty() || device_id.trim().is_empty() {
        return Err(LinqaError::InvalidInput("user and device IDs are required"));
    }
    if expires_at_unix <= created_at_unix {
        return Err(LinqaError::ValidationFailed("invalid key package lifetime"));
    }

    let public = secrets.public_identity();
    let mut package = KeyPackage {
        version: CURRENT_VERSION,
        user_id: user_id.to_owned(),
        device_id: device_id.to_owned(),
        signing_public_key: public.signing_public_key,
        encryption_public_key: public.encryption_public_key,
        pq_encryption_public_key: public.pq_encryption_public_key,
        created_at_unix,
        expires_at_unix,
        signature: [0; 64],
    };
    package.signature = secrets
        .signing_key()
        .sign(&package.unsigned_hash())
        .to_bytes();
    Ok(package)
}

pub fn validate_key_package(package: &KeyPackage, now_unix: i64) -> Result<()> {
    if package.version != CURRENT_VERSION {
        return Err(LinqaError::ValidationFailed("unsupported package version"));
    }
    if package.expires_at_unix <= package.created_at_unix {
        return Err(LinqaError::ValidationFailed("invalid package lifetime"));
    }
    if now_unix > package.expires_at_unix {
        return Err(LinqaError::Expired);
    }

    let key = VerifyingKey::from_bytes(&package.signing_public_key)
        .map_err(|_| LinqaError::ValidationFailed("invalid signing key"))?;
    key.verify(
        &package.unsigned_hash(),
        &Signature::from_bytes(&package.signature),
    )
    .map_err(|_| LinqaError::AuthenticationFailed)
}
