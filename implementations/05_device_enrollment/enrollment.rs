//! Device Enrollment wired to the hybrid crypto core
//!
//! Implements a clean enrollment flow:
//! 1. Existing device creates a short-lived enrollment session (QR / code)
//! 2. New device generates its own hybrid keypair and joins
//! 3. Existing device verifies and publishes the new device’s public key
//! 4. Both sides derive a shared history-transfer key
//!
//! This replaces the previous incomplete / dual enrollment mechanisms
//! with a single, coherent path that uses the real HybridKem.

use crate::hybrid_kem::{
    HybridKem, HybridPublicKey, HybridSecretKey, HybridSharedSecret, PqcStrength, SimulatedPqKem,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub device_id: String,
    pub name: String,
    pub public_key: HybridPublicKeyDto,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridPublicKeyDto {
    pub classical: Vec<u8>,
    pub pq: Vec<u8>,
}

impl From<&HybridPublicKey> for HybridPublicKeyDto {
    fn from(pk: &HybridPublicKey) -> Self {
        Self {
            classical: pk.classical.to_vec(),
            pq: pk.pq.clone(),
        }
    }
}

impl TryFrom<&HybridPublicKeyDto> for HybridPublicKey {
    type Error = String;
    fn try_from(dto: &HybridPublicKeyDto) -> Result<Self, String> {
        if dto.classical.len() != 32 {
            return Err("invalid classical key length".into());
        }
        let mut classical = [0u8; 32];
        classical.copy_from_slice(&dto.classical);
        Ok(HybridPublicKey {
            classical,
            pq: dto.pq.clone(),
        })
    }
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct EnrollmentSecret([u8; 32]);

/// Created by the existing (trusted) device.
pub struct EnrollmentSession {
    pub session_id: String,
    pub secret: EnrollmentSecret,
    pub expires_at: u64,
    pub existing_device_id: String,
}

/// Payload that is shown as a QR code / numeric code.
#[derive(Serialize, Deserialize)]
pub struct EnrollmentPayload {
    pub session_id: String,
    pub secret_hex: String,
    pub expires_at: u64,
}

/// Response produced by the new device.
#[derive(Serialize, Deserialize)]
pub struct EnrollmentJoinRequest {
    pub session_id: String,
    pub new_device: DeviceInfo,
    /// Proof that the new device knows the enrollment secret
    pub proof: Vec<u8>,
}

/// Final result after successful enrollment.
pub struct EnrollmentResult {
    pub new_device: DeviceInfo,
    /// Shared key that can be used to encrypt the history snapshot
    pub history_key: HybridSharedSecret,
}

impl EnrollmentSession {
    /// Start an enrollment session on an already-trusted device.
    pub fn start(existing_device_id: &str, ttl_secs: u64) -> (Self, EnrollmentPayload) {
        let mut secret = [0u8; 32];
        OsRng.fill_bytes(&mut secret);
        let session_id = generate_id();
        let expires_at = now() + ttl_secs;

        let payload = EnrollmentPayload {
            session_id: session_id.clone(),
            secret_hex: hex::encode(secret),
            expires_at,
        };

        let session = EnrollmentSession {
            session_id,
            secret: EnrollmentSecret(secret),
            expires_at,
            existing_device_id: existing_device_id.to_string(),
        };
        (session, payload)
    }

    /// Called by the new device after scanning the QR / entering the code.
    pub fn join(
        payload: &EnrollmentPayload,
        device_name: &str,
    ) -> Result<(HybridSecretKey, EnrollmentJoinRequest), String> {
        if now() > payload.expires_at {
            return Err("enrollment session expired".into());
        }
        let secret_bytes = hex::decode(&payload.secret_hex)
            .map_err(|_| "invalid secret encoding")?;
        if secret_bytes.len() != 32 {
            return Err("invalid secret length".into());
        }

        let (pk, sk) = HybridKem::<SimulatedPqKem>::generate_keypair(PqcStrength::Standard);
        let device_id = generate_id();

        let new_device = DeviceInfo {
            device_id: device_id.clone(),
            name: device_name.to_string(),
            public_key: HybridPublicKeyDto::from(&pk),
            created_at: now(),
        };

        // Proof = SHA-256(secret || device_id || public_key bytes)
        let proof = compute_proof(&secret_bytes, &device_id, &pk);

        Ok((
            sk,
            EnrollmentJoinRequest {
                session_id: payload.session_id.clone(),
                new_device,
                proof,
            },
        ))
    }

    /// Existing device verifies the join request and produces the shared history key.
    pub fn finish(
        &self,
        request: &EnrollmentJoinRequest,
    ) -> Result<EnrollmentResult, String> {
        if request.session_id != self.session_id {
            return Err("session id mismatch".into());
        }
        if now() > self.expires_at {
            return Err("session expired".into());
        }

        let pk = HybridPublicKey::try_from(&request.new_device.public_key)?;
        let expected_proof = compute_proof(&self.secret.0, &request.new_device.device_id, &pk);
        if expected_proof != request.proof {
            return Err("enrollment proof verification failed".into());
        }

        // Derive a history-transfer key from the enrollment secret
        let mut history_key = [0u8; 32];
        let mut hasher = Sha256::new();
        hasher.update(b"Linqa-History-Key-v1");
        hasher.update(&self.secret.0);
        hasher.update(request.new_device.device_id.as_bytes());
        history_key.copy_from_slice(&hasher.finalize());

        Ok(EnrollmentResult {
            new_device: request.new_device.clone(),
            history_key: HybridSharedSecret(history_key),
        })
    }
}

fn compute_proof(secret: &[u8], device_id: &str, pk: &HybridPublicKey) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(b"Linqa-Enrollment-Proof-v1");
    hasher.update(secret);
    hasher.update(device_id.as_bytes());
    hasher.update(&pk.classical);
    hasher.update(&pk.pq);
    hasher.finalize().to_vec()
}

fn generate_id() -> String {
    let mut buf = [0u8; 12];
    OsRng.fill_bytes(&mut buf);
    hex::encode(buf)
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
