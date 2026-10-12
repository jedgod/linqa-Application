//! UniFFI object API. Kotlin and Swift call these high-level JSON/base64
//! operations; no cryptographic primitive is duplicated in native clients.

use crate::ffi::{DecryptRequest, EncryptRequest, FfiCore};
use crate::identity::DeviceKeyMaterial;
use crate::key_package::{validate_key_package, KeyPackage};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::Arc;

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum NativeCoreError {
    #[error("invalid native secure-core input")]
    InvalidInput,
    #[error("native secure-core authentication failed")]
    AuthenticationFailed,
}

#[derive(uniffi::Object)]
pub struct NativeSecureCore {
    inner: FfiCore,
}

#[derive(Deserialize)]
struct TransparencyProof {
    leaf_hash: Vec<u8>,
    root_hash: Vec<u8>,
    leaf_index: u64,
    siblings: Vec<Vec<u8>>,
}

#[uniffi::export]
impl NativeSecureCore {
    #[uniffi::constructor]
    pub fn new() -> Result<Arc<Self>, NativeCoreError> {
        Ok(Arc::new(Self {
            inner: FfiCore::new().map_err(|_| NativeCoreError::InvalidInput)?,
        }))
    }

    #[uniffi::constructor]
    pub fn from_key_material(key_material_b64: String) -> Result<Arc<Self>, NativeCoreError> {
        let bytes = STANDARD
            .decode(key_material_b64)
            .map_err(|_| NativeCoreError::InvalidInput)?;
        let material: DeviceKeyMaterial =
            serde_json::from_slice(&bytes).map_err(|_| NativeCoreError::InvalidInput)?;
        Ok(Arc::new(Self {
            inner: FfiCore::from_key_material(material)
                .map_err(|_| NativeCoreError::InvalidInput)?,
        }))
    }

    pub fn export_key_material(&self) -> Result<String, NativeCoreError> {
        let bytes = serde_json::to_vec(&self.inner.export_key_material())
            .map_err(|_| NativeCoreError::InvalidInput)?;
        Ok(STANDARD.encode(bytes))
    }

    pub fn version(&self) -> String {
        crate::VERSION.to_owned()
    }

    pub fn protection_level(&self) -> String {
        "SOFTWARE_REQUIRES_OS_WRAPPING".to_owned()
    }

    pub fn generate_key_package(
        &self,
        user_id: String,
        device_id: String,
        expires_at: u64,
    ) -> Result<String, NativeCoreError> {
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let expires_at_unix = if expires_at > 10_000_000_000 {
            (expires_at / 1000) as i64
        } else {
            expires_at as i64
        };
        let package = self
            .inner
            .create_key_package(&user_id, &device_id, now, expires_at_unix)
            .map_err(|_| NativeCoreError::InvalidInput)?;
        let bytes = serde_json::to_vec(&package).map_err(|_| NativeCoreError::InvalidInput)?;
        Ok(STANDARD.encode(bytes))
    }

    pub fn verify_key_package(&self, package_b64: String) -> Result<(), NativeCoreError> {
        let bytes = STANDARD
            .decode(package_b64)
            .map_err(|_| NativeCoreError::InvalidInput)?;
        let package: KeyPackage =
            serde_json::from_slice(&bytes).map_err(|_| NativeCoreError::InvalidInput)?;
        validate_key_package(&package, time::OffsetDateTime::now_utc().unix_timestamp())
            .map_err(|_| NativeCoreError::AuthenticationFailed)
    }

    pub fn seal_call_key(&self, x25519: String, mlkem768: String, plaintext: String, aad: String) -> Result<String, NativeCoreError> {
        let decode = |s: String| { if s.len() > 90000 { return Err(NativeCoreError::InvalidInput); } STANDARD.decode(s).map_err(|_| NativeCoreError::InvalidInput) };
        let classical: [u8;32] = decode(x25519)?.try_into().map_err(|_| NativeCoreError::InvalidInput)?;
        let result = self.inner.seal_call_key(classical,decode(mlkem768)?,&decode(plaintext)?,&decode(aad)?).map_err(|_| NativeCoreError::AuthenticationFailed)?;
        Ok(STANDARD.encode(result))
    }
    pub fn open_call_key(&self, sealed: String, aad: String) -> Result<String, NativeCoreError> {
        if sealed.len() > 90000 || aad.len() > 1024 { return Err(NativeCoreError::InvalidInput); }
        let sealed = STANDARD.decode(sealed).map_err(|_| NativeCoreError::InvalidInput)?;
        let aad = STANDARD.decode(aad).map_err(|_| NativeCoreError::InvalidInput)?;
        Ok(STANDARD.encode(self.inner.open_call_key(&sealed,&aad).map_err(|_| NativeCoreError::AuthenticationFailed)?))
    }
    pub fn sign_call_message(&self, message: String) -> Result<String, NativeCoreError> {
        if message.len() > 90000 { return Err(NativeCoreError::InvalidInput); }
        let message = STANDARD.decode(message).map_err(|_| NativeCoreError::InvalidInput)?;
        Ok(STANDARD.encode(self.inner.sign_call_message(&message).map_err(|_| NativeCoreError::InvalidInput)?))
    }

    pub fn encrypt_message(&self, request_json: String) -> Result<String, NativeCoreError> {
        let request: EncryptRequest =
            serde_json::from_str(&request_json).map_err(|_| NativeCoreError::InvalidInput)?;
        let envelope = self
            .inner
            .encrypt(request)
            .map_err(|_| NativeCoreError::AuthenticationFailed)?;
        let bytes = serde_json::to_vec(&envelope).map_err(|_| NativeCoreError::InvalidInput)?;
        Ok(STANDARD.encode(bytes))
    }

    pub fn decrypt_message(&self, request_b64: String) -> Result<String, NativeCoreError> {
        let bytes = STANDARD
            .decode(request_b64)
            .map_err(|_| NativeCoreError::InvalidInput)?;
        let request: DecryptRequest =
            serde_json::from_slice(&bytes).map_err(|_| NativeCoreError::InvalidInput)?;
        let plaintext = self
            .inner
            .decrypt(request)
            .map_err(|_| NativeCoreError::AuthenticationFailed)?;
        Ok(STANDARD.encode(plaintext))
    }

    pub fn verify_transparency_proof(&self, proof_b64: String) -> Result<(), NativeCoreError> {
        let bytes = STANDARD
            .decode(proof_b64)
            .map_err(|_| NativeCoreError::InvalidInput)?;
        let proof: TransparencyProof =
            serde_json::from_slice(&bytes).map_err(|_| NativeCoreError::InvalidInput)?;
        if proof.leaf_hash.len() != 32 || proof.root_hash.len() != 32 {
            return Err(NativeCoreError::InvalidInput);
        }
        let mut current: [u8; 32] = proof
            .leaf_hash
            .as_slice()
            .try_into()
            .map_err(|_| NativeCoreError::InvalidInput)?;
        let mut index = proof.leaf_index;
        for sibling in proof.siblings {
            if sibling.len() != 32 {
                return Err(NativeCoreError::InvalidInput);
            }
            let mut hash = Sha256::new();
            hash.update([1]);
            if index & 1 == 0 {
                hash.update(current);
                hash.update(&sibling);
            } else {
                hash.update(&sibling);
                hash.update(current);
            }
            current = hash.finalize().into();
            index >>= 1;
        }
        if current.as_slice() != proof.root_hash {
            return Err(NativeCoreError::AuthenticationFailed);
        }
        Ok(())
    }
}
