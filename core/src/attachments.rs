use crate::error::{LinqaError, Result};
use blake3::Hasher;
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

const DOMAIN: &[u8] = b"linqa:attachment:v1";
pub const DEFAULT_CHUNK_SIZE: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentManifest {
    pub version: u16,
    pub attachment_id: String,
    pub file_name: String,
    pub media_type: String,
    pub plaintext_size: u64,
    pub chunk_size: u32,
    pub chunk_count: u32,
    pub nonce_prefix: [u8; 16],
    pub ciphertext_hash: [u8; 32],
}

#[derive(Debug, Clone)]
pub struct EncryptedAttachment {
    pub manifest: AttachmentManifest,
    pub key: [u8; 32],
    pub encrypted_chunks: Vec<Vec<u8>>,
}

fn chunk_nonce(prefix: &[u8; 16], index: u64) -> [u8; 24] {
    let mut nonce = [0u8; 24];
    nonce[..16].copy_from_slice(prefix);
    nonce[16..].copy_from_slice(&index.to_be_bytes());
    nonce
}

fn aad(attachment_id: &str, chunk_index: u32, chunk_count: u32, media_type: &str) -> Vec<u8> {
    [
        DOMAIN,
        attachment_id.as_bytes(),
        &chunk_index.to_be_bytes(),
        &chunk_count.to_be_bytes(),
        media_type.as_bytes(),
    ]
    .concat()
}

pub fn encrypt_attachment(
    attachment_id: &str,
    file_name: &str,
    media_type: &str,
    plaintext: &[u8],
    chunk_size: usize,
) -> Result<EncryptedAttachment> {
    if attachment_id.trim().is_empty() || file_name.trim().is_empty() {
        return Err(LinqaError::InvalidInput(
            "attachment identifiers are required",
        ));
    }
    if plaintext.is_empty() {
        return Err(LinqaError::InvalidInput("attachment is empty"));
    }
    if !(16 * 1024..=4 * 1024 * 1024).contains(&chunk_size) {
        return Err(LinqaError::InvalidInput("invalid chunk size"));
    }

    let mut key = [0u8; 32];
    let mut nonce_prefix = [0u8; 16];
    OsRng.fill_bytes(&mut key);
    OsRng.fill_bytes(&mut nonce_prefix);

    let chunk_count = plaintext.len().div_ceil(chunk_size) as u32;
    let cipher = XChaCha20Poly1305::new((&key).into());
    let mut encrypted_chunks = Vec::with_capacity(chunk_count as usize);
    let mut hasher = Hasher::new();

    for (index, chunk) in plaintext.chunks(chunk_size).enumerate() {
        let nonce = chunk_nonce(&nonce_prefix, index as u64);
        let encrypted = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: chunk,
                    aad: &aad(attachment_id, index as u32, chunk_count, media_type),
                },
            )
            .map_err(|_| LinqaError::CryptoFailure)?;
        hasher.update(&encrypted);
        encrypted_chunks.push(encrypted);
    }

    let manifest = AttachmentManifest {
        version: 1,
        attachment_id: attachment_id.to_owned(),
        file_name: file_name.to_owned(),
        media_type: media_type.to_owned(),
        plaintext_size: plaintext.len() as u64,
        chunk_size: chunk_size as u32,
        chunk_count,
        nonce_prefix,
        ciphertext_hash: *hasher.finalize().as_bytes(),
    };

    Ok(EncryptedAttachment {
        manifest,
        key,
        encrypted_chunks,
    })
}

pub fn decrypt_attachment(
    manifest: &AttachmentManifest,
    key: &[u8; 32],
    encrypted_chunks: &[Vec<u8>],
) -> Result<Vec<u8>> {
    if manifest.version != 1 {
        return Err(LinqaError::ValidationFailed(
            "unsupported attachment version",
        ));
    }
    if encrypted_chunks.len() != manifest.chunk_count as usize {
        return Err(LinqaError::ValidationFailed("chunk count mismatch"));
    }

    let mut hasher = Hasher::new();
    for chunk in encrypted_chunks {
        hasher.update(chunk);
    }
    if hasher.finalize().as_bytes() != &manifest.ciphertext_hash {
        return Err(LinqaError::AuthenticationFailed);
    }

    let cipher = XChaCha20Poly1305::new(key.into());
    let mut plaintext = Vec::with_capacity(manifest.plaintext_size as usize);

    for (index, encrypted) in encrypted_chunks.iter().enumerate() {
        let nonce = chunk_nonce(&manifest.nonce_prefix, index as u64);
        let decrypted = cipher
            .decrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: encrypted,
                    aad: &aad(
                        &manifest.attachment_id,
                        index as u32,
                        manifest.chunk_count,
                        &manifest.media_type,
                    ),
                },
            )
            .map_err(|_| LinqaError::AuthenticationFailed)?;
        plaintext.extend_from_slice(&decrypted);
    }

    if plaintext.len() as u64 != manifest.plaintext_size {
        plaintext.zeroize();
        return Err(LinqaError::ValidationFailed("plaintext size mismatch"));
    }

    Ok(plaintext)
}
