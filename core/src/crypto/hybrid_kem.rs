//! Real hybrid (classical + post-quantum) key encapsulation: X25519 combined
//! with ML-KEM-768 (FIPS 203), via HKDF-SHA256 domain separation. This
//! replaces the `SimulatedPqKem` prototype in `implementations/01_hybrid_crypto/`,
//! which filled keys and ciphertexts with random bytes rather than performing
//! real key encapsulation.

use hkdf::Hkdf;
use ml_kem::{
    kem::{Decapsulate, Encapsulate, Kem, KeyExport, TryKeyInit},
    Seed as MlKemSeed,
};
use rand_core::OsRng;
use sha2::Sha256;
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop};

type MlKem = ml_kem::MlKem768;
type MlKemDecapsulationKey = ml_kem::DecapsulationKey768;
type MlKemEncapsulationKey = ml_kem::EncapsulationKey768;

/// ML-KEM-768 encapsulation (public) key size in bytes.
pub const PQ_PUBLIC_KEY_BYTES: usize = 1184;
/// ML-KEM-768 seed (compact decapsulation/secret key) size in bytes.
pub const PQ_SECRET_SEED_BYTES: usize = 64;
/// ML-KEM-768 ciphertext size in bytes.
pub const PQ_CIPHERTEXT_BYTES: usize = 1088;

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct HybridSharedSecret(pub [u8; 32]);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HybridPublicKey {
    pub classical: [u8; 32],
    /// ML-KEM-768 encapsulation key, `PQ_PUBLIC_KEY_BYTES` bytes.
    pub pq: Vec<u8>,
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct HybridSecretKey {
    pub classical: [u8; 32],
    /// ML-KEM-768 seed (the compact, preferred decapsulation-key
    /// serialization), `PQ_SECRET_SEED_BYTES` bytes.
    pub pq: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HybridCiphertext {
    pub classical: [u8; 32],
    /// ML-KEM-768 ciphertext, `PQ_CIPHERTEXT_BYTES` bytes.
    pub pq: Vec<u8>,
}

pub fn generate_keypair() -> (HybridPublicKey, HybridSecretKey) {
    let classical_secret = StaticSecret::random_from_rng(OsRng);
    let classical_public = X25519PublicKey::from(&classical_secret);

    let (dk, ek) = MlKem::generate_keypair();
    let seed = dk.to_seed().expect("ML-KEM decapsulation key seed export");

    (
        HybridPublicKey {
            classical: classical_public.to_bytes(),
            pq: ek.to_bytes().to_vec(),
        },
        HybridSecretKey {
            classical: classical_secret.to_bytes(),
            pq: seed.to_vec(),
        },
    )
}

/// Re-derive the ML-KEM-768 public (encapsulation) key bytes from a stored
/// seed, so a device's public identity can be recomputed later without
/// having to separately persist the public key.
pub fn pq_public_key_from_seed(seed_bytes: &[u8]) -> Result<Vec<u8>, &'static str> {
    if seed_bytes.len() != PQ_SECRET_SEED_BYTES {
        return Err("invalid PQ secret seed length");
    }
    let seed = MlKemSeed::try_from(seed_bytes).map_err(|_| "invalid PQ secret seed")?;
    let dk = MlKemDecapsulationKey::from_seed(seed);
    Ok(dk.encapsulation_key().to_bytes().to_vec())
}

pub fn encapsulate(
    recipient_public: &HybridPublicKey,
) -> Result<(HybridCiphertext, HybridSharedSecret), &'static str> {
    if recipient_public.pq.len() != PQ_PUBLIC_KEY_BYTES {
        return Err("invalid recipient PQ public key length");
    }

    let ephemeral_secret = StaticSecret::random_from_rng(OsRng);
    let ephemeral_public = X25519PublicKey::from(&ephemeral_secret);
    let recipient_classical = X25519PublicKey::from(recipient_public.classical);
    let classical_shared = ephemeral_secret.diffie_hellman(&recipient_classical);

    let ek = MlKemEncapsulationKey::new_from_slice(&recipient_public.pq)
        .map_err(|_| "invalid recipient PQ public key")?;
    let (ct, pq_shared) = ek.encapsulate();

    let shared = combine_secrets(classical_shared.as_bytes(), &pq_shared)?;

    Ok((
        HybridCiphertext {
            classical: ephemeral_public.to_bytes(),
            pq: ct.to_vec(),
        },
        shared,
    ))
}

pub fn decapsulate(
    recipient_secret: &HybridSecretKey,
    ciphertext: &HybridCiphertext,
) -> Result<HybridSharedSecret, &'static str> {
    if recipient_secret.pq.len() != PQ_SECRET_SEED_BYTES {
        return Err("invalid recipient PQ secret seed length");
    }
    if ciphertext.pq.len() != PQ_CIPHERTEXT_BYTES {
        return Err("invalid PQ ciphertext length");
    }

    let ephemeral_public = X25519PublicKey::from(ciphertext.classical);
    let recipient_classical_secret = StaticSecret::from(recipient_secret.classical);
    let classical_shared = recipient_classical_secret.diffie_hellman(&ephemeral_public);

    let seed = MlKemSeed::try_from(recipient_secret.pq.as_slice())
        .map_err(|_| "invalid recipient PQ secret seed")?;
    let dk = MlKemDecapsulationKey::from_seed(seed);
    let pq_shared = dk
        .decapsulate_slice(&ciphertext.pq)
        .map_err(|_| "invalid PQ ciphertext")?;

    combine_secrets(classical_shared.as_bytes(), &pq_shared)
}

fn combine_secrets(classical: &[u8], pq: &[u8]) -> Result<HybridSharedSecret, &'static str> {
    let mut ikm = Vec::with_capacity(classical.len() + pq.len());
    ikm.extend_from_slice(classical);
    ikm.extend_from_slice(pq);

    let hk = Hkdf::<Sha256>::new(Some(b"Linqa-Hybrid-KEM-v1"), &ikm);
    let mut out = [0u8; 32];
    hk.expand(b"linqa:hybrid-kem:shared-secret:v1", &mut out)
        .map_err(|_| "hkdf expand failed")?;
    Ok(HybridSharedSecret(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hybrid_roundtrip_produces_matching_shared_secrets() {
        let (public, secret) = generate_keypair();
        let (ciphertext, sender_secret) = encapsulate(&public).unwrap();
        let recipient_secret = decapsulate(&secret, &ciphertext).unwrap();
        assert_eq!(sender_secret.0, recipient_secret.0);
    }

    #[test]
    fn different_keypairs_produce_different_shared_secrets() {
        let (public_a, _secret_a) = generate_keypair();
        let (public_b, secret_b) = generate_keypair();

        let (ciphertext_a, shared_for_a) = encapsulate(&public_a).unwrap();
        let (_ciphertext_b, shared_for_b) = encapsulate(&public_b).unwrap();
        assert_ne!(shared_for_a.0, shared_for_b.0);

        // b cannot decapsulate a ciphertext meant for a.
        let attempted = decapsulate(&secret_b, &ciphertext_a);
        if let Ok(wrong_secret) = attempted {
            assert_ne!(wrong_secret.0, shared_for_a.0);
        }
    }

    #[test]
    fn tampered_ciphertext_does_not_reproduce_the_shared_secret() {
        let (public, secret) = generate_keypair();
        let (mut ciphertext, sender_secret) = encapsulate(&public).unwrap();
        ciphertext.pq[0] ^= 0xFF;

        let recipient_secret = decapsulate(&secret, &ciphertext).unwrap();
        assert_ne!(sender_secret.0, recipient_secret.0);
    }

    #[test]
    fn rejects_malformed_key_and_ciphertext_lengths() {
        let (public, secret) = generate_keypair();
        let mut bad_public = public.clone();
        bad_public.pq.truncate(10);
        assert!(encapsulate(&bad_public).is_err());

        let (mut ciphertext, _) = encapsulate(&public).unwrap();
        ciphertext.pq.truncate(10);
        assert!(decapsulate(&secret, &ciphertext).is_err());
    }
}
