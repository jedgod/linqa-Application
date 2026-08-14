use crate::error::{LinqaError, Result};
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

const DOMAIN: &[u8] = b"linqa:backup:v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupArchive {
    pub version: u16,
    pub backup_id: String,
    pub created_at_unix: i64,
    pub salt: [u8; 16],
    pub nonce: [u8; 24],
    pub plaintext_hash: [u8; 32],
    pub ciphertext: Vec<u8>,
}

fn derive(passphrase: &[u8], salt: &[u8; 16]) -> Result<[u8; 32]> {
    if passphrase.len() < 12 {
        return Err(LinqaError::InvalidInput("backup passphrase is too short"));
    }

    let params = Params::new(128 * 1024, 3, 1, Some(32)).map_err(|_| LinqaError::CryptoFailure)?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = [0u8; 32];
    argon2
        .hash_password_into(passphrase, salt, &mut key)
        .map_err(|_| LinqaError::CryptoFailure)?;
    Ok(key)
}

pub fn create_backup(
    backup_id: &str,
    created_at_unix: i64,
    plaintext: &[u8],
    passphrase: &[u8],
) -> Result<BackupArchive> {
    if backup_id.trim().is_empty() || plaintext.is_empty() {
        return Err(LinqaError::InvalidInput("backup data is incomplete"));
    }

    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);

    let mut key = derive(passphrase, &salt)?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    let plaintext_hash: [u8; 32] = Sha256::digest(plaintext).into();

    let aad = [
        DOMAIN,
        backup_id.as_bytes(),
        &created_at_unix.to_be_bytes(),
        &plaintext_hash,
    ]
    .concat();

    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| LinqaError::CryptoFailure)?;
    key.zeroize();

    Ok(BackupArchive {
        version: 1,
        backup_id: backup_id.to_owned(),
        created_at_unix,
        salt,
        nonce,
        plaintext_hash,
        ciphertext,
    })
}

pub fn restore_backup(archive: &BackupArchive, passphrase: &[u8]) -> Result<Vec<u8>> {
    if archive.version != 1 {
        return Err(LinqaError::ValidationFailed("unsupported backup version"));
    }

    let mut key = derive(passphrase, &archive.salt)?;
    let cipher = XChaCha20Poly1305::new((&key).into());

    let aad = [
        DOMAIN,
        archive.backup_id.as_bytes(),
        &archive.created_at_unix.to_be_bytes(),
        &archive.plaintext_hash,
    ]
    .concat();

    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(&archive.nonce),
            Payload {
                msg: &archive.ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| LinqaError::AuthenticationFailed)?;
    key.zeroize();

    let actual: [u8; 32] = Sha256::digest(&plaintext).into();
    if actual != archive.plaintext_hash {
        return Err(LinqaError::AuthenticationFailed);
    }

    Ok(plaintext)
}
