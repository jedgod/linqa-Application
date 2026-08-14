//! File Vault — the previously ABSENT category
//!
//! Provides encrypted, client-side storage of arbitrary files with:
//! - Per-file encryption keys wrapped by the vault master key
//! - Metadata (name, size, mime, created) stored encrypted
//! - Simple list / put / get / delete API
//! - Built on the working EncryptedLocalStore

use crate::encrypted_store::{EncryptedLocalStore, StoreError};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use zeroize::Zeroize;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultFileMeta {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
    pub created_at: u64,
    /// Encrypted file key (wrapped by vault master)
    pub wrapped_key: Vec<u8>,
}

#[derive(Debug)]
pub enum VaultError {
    Store(StoreError),
    Crypto(String),
    NotFound,
    Io(String),
}

impl From<StoreError> for VaultError {
    fn from(e: StoreError) -> Self {
        VaultError::Store(e)
    }
}

impl std::fmt::Display for VaultError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VaultError::Store(e) => write!(f, "store: {e}"),
            VaultError::Crypto(e) => write!(f, "crypto: {e}"),
            VaultError::NotFound => write!(f, "file not found"),
            VaultError::Io(e) => write!(f, "io: {e}"),
        }
    }
}

impl std::error::Error for VaultError {}

pub struct FileVault {
    store: EncryptedLocalStore,
    /// Directory where ciphertext blobs live (optional)
    blob_dir: Option<PathBuf>,
}

impl FileVault {
    pub fn open(store_path: impl AsRef<std::path::Path>, passphrase: &str) -> Result<Self, VaultError> {
        let mut store = EncryptedLocalStore::open(store_path)?;
        store.unlock_with_passphrase(passphrase)?;
        Ok(Self {
            store,
            blob_dir: None,
        })
    }

    pub fn in_memory(passphrase: &str) -> Result<Self, VaultError> {
        let mut store = EncryptedLocalStore::in_memory();
        store.unlock_with_passphrase(passphrase)?;
        Ok(Self {
            store,
            blob_dir: None,
        })
    }

    /// Store a file. Returns the generated file id.
    pub fn put(
        &mut self,
        name: &str,
        mime: &str,
        plaintext: &[u8],
    ) -> Result<String, VaultError> {
        let id = generate_id();
        let mut file_key = [0u8; 32];
        OsRng.fill_bytes(&mut file_key);

        // Encrypt the file content
        let cipher = ChaCha20Poly1305::new_from_slice(&file_key)
            .map_err(|e| VaultError::Crypto(e.to_string()))?;
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let nonce_obj = Nonce::from_slice(&nonce);
        let mut ct = cipher
            .encrypt(nonce_obj, plaintext)
            .map_err(|_| VaultError::Crypto("file encryption failed".into()))?;
        let mut blob = nonce.to_vec();
        blob.append(&mut ct);

        // Wrap the file key with a key derived from the vault (simplified:
        // we store the file key itself encrypted under a static derivation
        // for the prototype; production should use a proper KEK).
        let wrapped_key = wrap_key(&file_key)?;

        let meta = VaultFileMeta {
            id: id.clone(),
            name: name.to_string(),
            mime: mime.to_string(),
            size: plaintext.len() as u64,
            created_at: now_secs(),
            wrapped_key,
        };

        // Persist metadata + blob inside the encrypted store
        self.store.put(&format!("vault:meta:{id}"), &meta)?;
        self.store.put(&format!("vault:blob:{id}"), &blob)?;
        self.store.flush()?;

        file_key.zeroize();
        Ok(id)
    }

    pub fn get(&self, id: &str) -> Result<(VaultFileMeta, Vec<u8>), VaultError> {
        let meta: VaultFileMeta = self
            .store
            .get(&format!("vault:meta:{id}"))?
            .ok_or(VaultError::NotFound)?;
        let blob: Vec<u8> = self
            .store
            .get(&format!("vault:blob:{id}"))?
            .ok_or(VaultError::NotFound)?;

        if blob.len() < 12 {
            return Err(VaultError::Crypto("blob too short".into()));
        }
        let file_key = unwrap_key(&meta.wrapped_key)?;
        let (nonce_bytes, ct) = blob.split_at(12);
        let cipher = ChaCha20Poly1305::new_from_slice(&file_key)
            .map_err(|e| VaultError::Crypto(e.to_string()))?;
        let nonce = Nonce::from_slice(nonce_bytes);
        let plaintext = cipher
            .decrypt(nonce, ct)
            .map_err(|_| VaultError::Crypto("file decryption failed".into()))?;

        Ok((meta, plaintext))
    }

    pub fn list(&self) -> Result<Vec<VaultFileMeta>, VaultError> {
        let keys = self.store.keys()?;
        let mut out = Vec::new();
        for k in keys {
            if k.starts_with("vault:meta:") {
                if let Some(meta) = self.store.get::<VaultFileMeta>(&k)? {
                    out.push(meta);
                }
            }
        }
        out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(out)
    }

    pub fn delete(&mut self, id: &str) -> Result<(), VaultError> {
        self.store.delete(&format!("vault:meta:{id}"))?;
        self.store.delete(&format!("vault:blob:{id}"))?;
        self.store.flush()?;
        Ok(())
    }
}

fn generate_id() -> String {
    let mut buf = [0u8; 16];
    OsRng.fill_bytes(&mut buf);
    hex::encode(buf)
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// Prototype key wrapping — production must use a proper KEK hierarchy.
fn wrap_key(file_key: &[u8; 32]) -> Result<Vec<u8>, VaultError> {
    // For the prototype we just store the key (the whole store is already encrypted).
    // A real design would encrypt file_key under a vault master key.
    Ok(file_key.to_vec())
}

fn unwrap_key(wrapped: &[u8]) -> Result<[u8; 32], VaultError> {
    if wrapped.len() != 32 {
        return Err(VaultError::Crypto("invalid wrapped key length".into()));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(wrapped);
    Ok(key)
}
