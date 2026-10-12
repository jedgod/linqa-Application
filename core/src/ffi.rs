use crate::{
    enrollment::{create_proof, EnrollmentChallenge, EnrollmentProof},
    envelope::{decrypt, encrypt, MessageEnvelope},
    identity::{DeviceKeyMaterial, DeviceSecrets},
    key_package::create_key_package,
    replay::ReplayCache,
    LinqaError,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FfiRuntimeInfo {
    pub api_version: u32,
    pub protocol_version: u16,
    pub build_version: String,
    pub secure_core_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptRequest {
    pub recipient_encryption_public_key: [u8; 32],
    pub recipient_pq_encryption_public_key: Vec<u8>,
    pub sender_user_id: String,
    pub sender_device_id: String,
    pub recipient_user_id: String,
    pub recipient_device_id: String,
    pub message_id: String,
    pub plaintext: Vec<u8>,
    pub created_at_unix: i64,
    pub expires_at_unix: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecryptRequest {
    pub expected_recipient_device_id: String,
    pub sender_signing_public_key: [u8; 32],
    pub envelope: MessageEnvelope,
    pub now_unix: i64,
}

pub struct FfiCore {
    secrets: DeviceSecrets,
    replay: Mutex<ReplayCache>,
}

impl FfiCore {
    pub fn new() -> Result<Self, LinqaError> {
        Ok(Self {
            secrets: DeviceSecrets::generate(),
            replay: Mutex::new(ReplayCache::new(50_000)?),
        })
    }

    /// Same as `new`, but replay protection is backed by a durable, fsync'd
    /// log at `path` instead of memory only — a crash or restart does not
    /// reset which message IDs have already been seen.
    pub fn new_with_replay_path(path: impl AsRef<Path>) -> Result<Self, LinqaError> {
        Ok(Self {
            secrets: DeviceSecrets::generate(),
            replay: Mutex::new(ReplayCache::open_file(50_000, path)?),
        })
    }

    pub fn from_key_material(material: DeviceKeyMaterial) -> Result<Self, LinqaError> {
        Ok(Self {
            secrets: DeviceSecrets::from_key_material(material)?,
            replay: Mutex::new(ReplayCache::new(50_000)?),
        })
    }

    pub fn export_key_material(&self) -> DeviceKeyMaterial {
        self.secrets.export_key_material()
    }

    pub fn runtime_info(&self) -> FfiRuntimeInfo {
        FfiRuntimeInfo {
            api_version: 1,
            protocol_version: 1,
            build_version: env!("CARGO_PKG_VERSION").to_owned(),
            secure_core_ready: true,
        }
    }

    pub fn public_signing_key(&self) -> [u8; 32] {
        self.secrets.public_identity().signing_public_key
    }

    pub fn public_encryption_key(&self) -> [u8; 32] {
        self.secrets.public_identity().encryption_public_key
    }

    pub fn public_pq_encryption_key(&self) -> Vec<u8> {
        self.secrets.public_identity().pq_encryption_public_key
    }

    pub fn seal_call_key(&self, x25519: [u8;32], mlkem768: Vec<u8>, plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, &'static str> {
        crate::call_crypto::seal(&crate::crypto::hybrid_kem::HybridPublicKey { classical:x25519, pq:mlkem768 }, plaintext, aad)
    }
    pub fn open_call_key(&self, sealed: &[u8], aad: &[u8]) -> Result<Vec<u8>, &'static str> {
        let secret = crate::crypto::hybrid_kem::HybridSecretKey { classical:self.secrets.encryption_secret().to_bytes(), pq:self.secrets.pq_encryption_secret().to_vec() };
        crate::call_crypto::open(&secret,sealed,aad)
    }
    pub fn sign_call_message(&self, message: &[u8]) -> Result<Vec<u8>, &'static str> {
        use ed25519_dalek::Signer;
        if message.len() > 65536 || !(message.starts_with(b"linqa-call-env-v1{") || message.starts_with(b"linqa-call-sig-v1{")) { return Err("invalid call signing context"); }
        Ok(self.secrets.signing_key().sign(message).to_bytes().to_vec())
    }

    pub fn encrypt(&self, request: EncryptRequest) -> Result<MessageEnvelope, LinqaError> {
        encrypt(
            &self.secrets,
            request.recipient_encryption_public_key,
            &request.recipient_pq_encryption_public_key,
            &request.sender_user_id,
            &request.sender_device_id,
            &request.recipient_user_id,
            &request.recipient_device_id,
            &request.message_id,
            &request.plaintext,
            request.created_at_unix,
            request.expires_at_unix,
        )
    }

    pub fn decrypt(&self, request: DecryptRequest) -> Result<Vec<u8>, LinqaError> {
        let mut replay = self
            .replay
            .lock()
            .map_err(|_| LinqaError::InvalidState("replay cache lock poisoned"))?;

        decrypt(
            &self.secrets,
            &request.expected_recipient_device_id,
            request.sender_signing_public_key,
            &request.envelope,
            request.now_unix,
            &mut replay,
        )
    }

    pub fn create_key_package(
        &self,
        user_id: &str,
        device_id: &str,
        created_at_unix: i64,
        expires_at_unix: i64,
    ) -> Result<crate::key_package::KeyPackage, LinqaError> {
        create_key_package(
            &self.secrets,
            user_id,
            device_id,
            created_at_unix,
            expires_at_unix,
        )
    }

    pub fn create_enrollment_proof(
        &self,
        challenge: &EnrollmentChallenge,
        device_name: &str,
        platform: &str,
    ) -> Result<EnrollmentProof, LinqaError> {
        create_proof(challenge, &self.secrets, device_name, platform)
    }
}
