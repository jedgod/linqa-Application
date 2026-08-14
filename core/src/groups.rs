use crate::error::{LinqaError, Result};
use ed25519_dalek::{Signature, Signer, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_big_array::BigArray;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const DOMAIN: &[u8] = b"linqa:group-state:v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum GroupRole {
    Owner,
    Admin,
    Member,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMember {
    pub user_id: String,
    pub device_id: String,
    pub role: GroupRole,
    pub signing_public_key: [u8; 32],
    pub encryption_public_key: [u8; 32],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupState {
    pub version: u16,
    pub group_id: String,
    pub epoch: u64,
    pub title: String,
    pub members: BTreeMap<String, GroupMember>,
    pub updated_at_unix: i64,
    pub previous_state_hash: Option<[u8; 32]>,
    pub signer_device_id: String,
    #[serde(with = "BigArray")]
    pub signature: [u8; 64],
}

impl GroupState {
    pub fn unsigned_hash(&self) -> Result<[u8; 32]> {
        let mut clone = self.clone();
        clone.signature = [0u8; 64];
        let bytes = postcard::to_allocvec(&clone).map_err(|_| LinqaError::SerializationFailure)?;
        let mut h = Sha256::new();
        h.update(DOMAIN);
        h.update(bytes);
        Ok(h.finalize().into())
    }

    pub fn state_hash(&self) -> Result<[u8; 32]> {
        let mut h = Sha256::new();
        h.update(self.unsigned_hash()?);
        h.update(self.signature);
        Ok(h.finalize().into())
    }
}

pub fn sign_group_state(
    mut state: GroupState,
    signing_key: &ed25519_dalek::SigningKey,
) -> Result<GroupState> {
    if state.group_id.trim().is_empty() || state.members.is_empty() {
        return Err(LinqaError::InvalidInput("group state is incomplete"));
    }

    let signer = state
        .members
        .get(&state.signer_device_id)
        .ok_or(LinqaError::AuthenticationFailed)?;

    if !matches!(signer.role, GroupRole::Owner | GroupRole::Admin) {
        return Err(LinqaError::AuthenticationFailed);
    }

    state.signature = signing_key.sign(&state.unsigned_hash()?).to_bytes();
    Ok(state)
}

pub fn verify_group_transition(previous: &GroupState, next: &GroupState) -> Result<()> {
    if previous.group_id != next.group_id {
        return Err(LinqaError::ValidationFailed("group ID mismatch"));
    }
    if next.epoch != previous.epoch + 1 {
        return Err(LinqaError::ValidationFailed(
            "group epoch is not sequential",
        ));
    }
    if next.previous_state_hash != Some(previous.state_hash()?) {
        return Err(LinqaError::AuthenticationFailed);
    }

    let signer = previous
        .members
        .get(&next.signer_device_id)
        .ok_or(LinqaError::AuthenticationFailed)?;

    if !matches!(signer.role, GroupRole::Owner | GroupRole::Admin) {
        return Err(LinqaError::AuthenticationFailed);
    }

    let key = VerifyingKey::from_bytes(&signer.signing_public_key)
        .map_err(|_| LinqaError::ValidationFailed("invalid group signer key"))?;
    key.verify(
        &next.unsigned_hash()?,
        &Signature::from_bytes(&next.signature),
    )
    .map_err(|_| LinqaError::AuthenticationFailed)
}
