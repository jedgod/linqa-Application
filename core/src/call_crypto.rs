//! Hybrid envelopes for call keys. Identity private keys remain in the core.
use crate::crypto::hybrid_kem::{self, HybridCiphertext, HybridPublicKey, HybridSecretKey};
use chacha20poly1305::{aead::{Aead, KeyInit, Payload}, XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::Zeroizing;

const DOMAIN: &[u8] = b"linqa:call-key-envelope:v1";
const MAX_PAYLOAD: usize = 8192;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope { v: u8, classical: [u8;32], pq: Vec<u8>, nonce: [u8;24], ciphertext: Vec<u8> }

fn validate_aad(aad: &[u8]) -> Result<(), &'static str> {
    if aad.len() > 512 || !aad.starts_with(b"linqa-call-env-v1|") { return Err("invalid call context"); }
    Ok(())
}
fn key(secret: &[u8], aad: &[u8]) -> Result<Zeroizing<[u8;32]>, &'static str> {
    let mut key = Zeroizing::new([0u8;32]);
    Hkdf::<Sha256>::new(Some(DOMAIN), secret).expand(aad, &mut *key).map_err(|_| "invalid call key")?;
    Ok(key)
}
fn context(e: &Envelope, aad: &[u8]) -> Vec<u8> {
    let mut out = DOMAIN.to_vec(); out.push(e.v); out.extend_from_slice(&e.classical);
    out.extend_from_slice(&e.pq); out.extend_from_slice(&e.nonce); out.extend_from_slice(aad); out
}
pub fn seal(recipient: &HybridPublicKey, plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, &'static str> {
    validate_aad(aad)?;
    if plaintext.is_empty() || plaintext.len() > MAX_PAYLOAD { return Err("invalid call payload size"); }
    let (ct, shared) = hybrid_kem::encapsulate(recipient)?;
    let key = key(&shared.0, aad)?;
    let mut e = Envelope { v:1, classical:ct.classical, pq:ct.pq, nonce:[0;24], ciphertext:vec![] };
    OsRng.fill_bytes(&mut e.nonce);
    let cipher = XChaCha20Poly1305::new((&*key).into());
    e.ciphertext = cipher.encrypt(XNonce::from_slice(&e.nonce), Payload { msg:plaintext, aad:&context(&e,aad) }).map_err(|_| "call sealing failed")?;
    serde_json::to_vec(&e).map_err(|_| "invalid call envelope")
}
pub fn open(recipient: &HybridSecretKey, sealed: &[u8], aad: &[u8]) -> Result<Vec<u8>, &'static str> {
    validate_aad(aad)?;
    if sealed.len() > 65536 { return Err("call envelope too large"); }
    let e: Envelope = serde_json::from_slice(sealed).map_err(|_| "invalid call envelope")?;
    if e.v != 1 || e.pq.len() != hybrid_kem::PQ_CIPHERTEXT_BYTES || e.ciphertext.len() > MAX_PAYLOAD+16 || e.ciphertext.len() <= 16 { return Err("invalid call envelope"); }
    let shared = hybrid_kem::decapsulate(recipient, &HybridCiphertext { classical:e.classical, pq:e.pq.clone() })?;
    let key = key(&shared.0, aad)?;
    XChaCha20Poly1305::new((&*key).into()).decrypt(XNonce::from_slice(&e.nonce), Payload { msg:&e.ciphertext, aad:&context(&e,aad) }).map_err(|_| "call authentication failed")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn call_envelope_binds_device_and_context() {
        let (pk, sk) = hybrid_kem::generate_keypair(); let (_, wrong) = hybrid_kem::generate_keypair();
        let aad = b"linqa-call-env-v1|call|user:device";
        let envelope = seal(&pk, b"call-key-and-signature", aad).unwrap();
        assert_eq!(open(&sk, &envelope, aad).unwrap(), b"call-key-and-signature");
        assert!(open(&wrong,&envelope,aad).is_err());
        assert!(open(&sk,&envelope,b"linqa-call-env-v1|other|user:device").is_err());
        let mut modified: Envelope = serde_json::from_slice(&envelope).unwrap(); modified.nonce[0] ^= 1;
        assert!(open(&sk,&serde_json::to_vec(&modified).unwrap(),aad).is_err());
    }
    #[test] fn rejects_unbounded_or_non_call_inputs() {
        let (pk,sk)=hybrid_kem::generate_keypair();
        assert!(seal(&pk,&[0;8193],b"linqa-call-env-v1|call|u:d").is_err());
        assert!(seal(&pk,b"secret",b"chat-context").is_err());
        assert!(open(&sk,&[0;65537],b"linqa-call-env-v1|call|u:d").is_err());
    }
}
