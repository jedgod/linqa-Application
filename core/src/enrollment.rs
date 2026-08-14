use crate::{
    error::{LinqaError, Result},
    identity::DeviceSecrets,
};
use ed25519_dalek::{Signature, Signer, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_big_array::BigArray;
use sha2::{Digest, Sha256};

const DOMAIN: &[u8] = b"linqa:device-enrollment:v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrollmentChallenge {
    pub challenge_id: String,
    pub user_id: String,
    pub nonce: [u8; 32],
    pub expires_at_unix: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrollmentProof {
    pub challenge_id: String,
    pub user_id: String,
    pub device_name: String,
    pub platform: String,
    pub signing_public_key: [u8; 32],
    pub encryption_public_key: [u8; 32],
    #[serde(with = "BigArray")]
    pub signature: [u8; 64],
}

fn canonical_bytes(
    challenge: &EnrollmentChallenge,
    device_name: &str,
    platform: &str,
    signing_public_key: &[u8; 32],
    encryption_public_key: &[u8; 32],
) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(DOMAIN);
    hasher.update(challenge.challenge_id.as_bytes());
    hasher.update(challenge.user_id.as_bytes());
    hasher.update(challenge.nonce);
    hasher.update(challenge.expires_at_unix.to_be_bytes());
    hasher.update(device_name.as_bytes());
    hasher.update(platform.as_bytes());
    hasher.update(signing_public_key);
    hasher.update(encryption_public_key);
    hasher.finalize().to_vec()
}

pub fn create_proof(
    challenge: &EnrollmentChallenge,
    secrets: &DeviceSecrets,
    device_name: &str,
    platform: &str,
) -> Result<EnrollmentProof> {
    if device_name.trim().is_empty() || platform.trim().is_empty() {
        return Err(LinqaError::InvalidInput(
            "device name and platform are required",
        ));
    }

    let public = secrets.public_identity();
    let signature = secrets.signing_key().sign(&canonical_bytes(
        challenge,
        device_name,
        platform,
        &public.signing_public_key,
        &public.encryption_public_key,
    ));

    Ok(EnrollmentProof {
        challenge_id: challenge.challenge_id.clone(),
        user_id: challenge.user_id.clone(),
        device_name: device_name.to_owned(),
        platform: platform.to_owned(),
        signing_public_key: public.signing_public_key,
        encryption_public_key: public.encryption_public_key,
        signature: signature.to_bytes(),
    })
}

pub fn verify_proof(
    challenge: &EnrollmentChallenge,
    proof: &EnrollmentProof,
    now_unix: i64,
) -> Result<()> {
    if now_unix > challenge.expires_at_unix {
        return Err(LinqaError::Expired);
    }
    if proof.challenge_id != challenge.challenge_id || proof.user_id != challenge.user_id {
        return Err(LinqaError::AuthenticationFailed);
    }

    let key = VerifyingKey::from_bytes(&proof.signing_public_key)
        .map_err(|_| LinqaError::ValidationFailed("invalid signing key"))?;
    let signature = Signature::from_bytes(&proof.signature);

    key.verify(
        &canonical_bytes(
            challenge,
            &proof.device_name,
            &proof.platform,
            &proof.signing_public_key,
            &proof.encryption_public_key,
        ),
        &signature,
    )
    .map_err(|_| LinqaError::AuthenticationFailed)
}
