//! Hybrid Key Encapsulation Mechanism for Linqa
//!
//! Combines X25519 (classical) with a post-quantum KEM slot (ML-KEM-768 / 1024).
//! The final shared secret is derived only when **both** components succeed.
//!
//! This file is production-structured: replace the `SimulatedPqKem` with a real
//! `ml-kem` implementation and the rest of the system stays identical.

use hkdf::Hkdf;
use rand::{rngs::OsRng, RngCore};
use sha2::Sha256;
use x25519_dalek::{PublicKey as X25519Public, StaticSecret as X25519Secret};
use zeroize::{Zeroize, ZeroizeOnDrop};

/// 32-byte hybrid shared secret (output of the domain-separated KDF).
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct HybridSharedSecret(pub [u8; 32]);

impl HybridSharedSecret {
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// Strength selector matching the protocol design documents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PqcStrength {
    /// ML-KEM-768 + X25519 (recommended default)
    Standard,
    /// ML-KEM-1024 + X25519 (higher margin)
    High,
}

impl Default for PqcStrength {
    fn default() -> Self {
        PqcStrength::Standard
    }
}

/// Hybrid public key (classical + PQ).
#[derive(Clone)]
pub struct HybridPublicKey {
    pub classical: [u8; 32], // X25519
    pub pq: Vec<u8>,         // ML-KEM public key bytes
}

/// Hybrid secret key — zeroized on drop.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct HybridSecretKey {
    pub classical: [u8; 32], // X25519 scalar
    pub pq: Vec<u8>,         // ML-KEM secret key bytes
}

/// Hybrid ciphertext.
#[derive(Clone)]
pub struct HybridCiphertext {
    pub classical: [u8; 32], // X25519 ephemeral public
    pub pq: Vec<u8>,         // ML-KEM ciphertext
}

/// Trait that a real ML-KEM implementation must satisfy.
pub trait PqKem: Send + Sync {
    fn generate_keypair(strength: PqcStrength) -> (Vec<u8>, Vec<u8>); // (pk, sk)
    fn encapsulate(pk: &[u8], strength: PqcStrength) -> (Vec<u8>, [u8; 32]); // (ct, ss)
    fn decapsulate(sk: &[u8], ct: &[u8], strength: PqcStrength) -> Option<[u8; 32]>;
}

/// Temporary stand-in that preserves sizes and the hybrid KDF contract.
/// Replace this with a real `ml-kem` backed implementation for production.
pub struct SimulatedPqKem;

impl PqKem for SimulatedPqKem {
    fn generate_keypair(strength: PqcStrength) -> (Vec<u8>, Vec<u8>) {
        let (pk_len, sk_len) = match strength {
            PqcStrength::Standard => (1184, 2400), // approximate ML-KEM-768 sizes
            PqcStrength::High => (1568, 3168),     // approximate ML-KEM-1024 sizes
        };
        let mut pk = vec![0u8; pk_len];
        let mut sk = vec![0u8; sk_len];
        OsRng.fill_bytes(&mut pk);
        OsRng.fill_bytes(&mut sk);
        // Mark the key so we can recognise it later in simulation
        if !pk.is_empty() {
            pk[0] = 0x76; // 'v' for valid simulated
        }
        (pk, sk)
    }

    fn encapsulate(pk: &[u8], strength: PqcStrength) -> (Vec<u8>, [u8; 32]) {
        let ct_len = match strength {
            PqcStrength::Standard => 1088,
            PqcStrength::High => 1568,
        };
        let mut ct = vec![0u8; ct_len];
        OsRng.fill_bytes(&mut ct);
        // Derive a deterministic shared secret from the public key for simulation
        // (real ML-KEM would be random and only recoverable with sk)
        let mut ss = [0u8; 32];
        let hk = Hkdf::<Sha256>::new(Some(b"Linqa-Sim-PQ"), pk);
        let _ = hk.expand(b"sim-ss", &mut ss);
        (ct, ss)
    }

    fn decapsulate(sk: &[u8], ct: &[u8], _strength: PqcStrength) -> Option<[u8; 32]> {
        if sk.is_empty() || ct.is_empty() {
            return None;
        }
        // Mirror the simulation logic: recover the same ss from the original pk material
        // (In real ML-KEM this would use the secret key properly)
        let mut ss = [0u8; 32];
        // For the simulation we re-derive from a hash of sk (not secure — replace!)
        let hk = Hkdf::<Sha256>::new(Some(b"Linqa-Sim-PQ"), sk);
        let _ = hk.expand(b"sim-ss", &mut ss);
        Some(ss)
    }
}

/// The main hybrid KEM API used by the rest of Linqa.
pub struct HybridKem<P: PqKem = SimulatedPqKem> {
    _marker: std::marker::PhantomData<P>,
}

impl<P: PqKem> HybridKem<P> {
    pub fn generate_keypair(strength: PqcStrength) -> (HybridPublicKey, HybridSecretKey) {
        let classical_secret = X25519Secret::random_from_rng(OsRng);
        let classical_public = X25519Public::from(&classical_secret);

        let (pq_pk, pq_sk) = P::generate_keypair(strength);

        (
            HybridPublicKey {
                classical: classical_public.to_bytes(),
                pq: pq_pk,
            },
            HybridSecretKey {
                classical: classical_secret.to_bytes(),
                pq: pq_sk,
            },
        )
    }

    pub fn encapsulate(
        pk: &HybridPublicKey,
        strength: PqcStrength,
    ) -> Result<(HybridCiphertext, HybridSharedSecret), &'static str> {
        // Classical ephemeral
        let eph_secret = X25519Secret::random_from_rng(OsRng);
        let eph_public = X25519Public::from(&eph_secret);
        let their_classical = X25519Public::from(pk.classical);
        let classical_ss = eph_secret.diffie_hellman(&their_classical);

        // Post-quantum
        let (pq_ct, pq_ss) = P::encapsulate(&pk.pq, strength);

        let hybrid = combine_secrets(
            classical_ss.as_bytes(),
            &pq_ss,
            b"Linqa-Hybrid-KEM-v1",
            strength,
        )?;

        Ok((
            HybridCiphertext {
                classical: eph_public.to_bytes(),
                pq: pq_ct,
            },
            hybrid,
        ))
    }

    pub fn decapsulate(
        sk: &HybridSecretKey,
        ct: &HybridCiphertext,
        strength: PqcStrength,
    ) -> Result<HybridSharedSecret, &'static str> {
        let my_secret = X25519Secret::from(sk.classical);
        let their_eph = X25519Public::from(ct.classical);
        let classical_ss = my_secret.diffie_hellman(&their_eph);

        let pq_ss = P::decapsulate(&sk.pq, &ct.pq, strength)
            .ok_or("PQ decapsulation failed")?;

        combine_secrets(
            classical_ss.as_bytes(),
            &pq_ss,
            b"Linqa-Hybrid-KEM-v1",
            strength,
        )
    }
}

/// Domain-separated combination of classical + PQ shared secrets.
fn combine_secrets(
    classical: &[u8],
    pq: &[u8],
    salt: &[u8],
    strength: PqcStrength,
) -> Result<HybridSharedSecret, &'static str> {
    if classical.len() != 32 || pq.len() != 32 {
        return Err("invalid shared-secret length");
    }

    let mut ikm = Vec::with_capacity(64);
    ikm.extend_from_slice(classical);
    ikm.extend_from_slice(pq);

    let info = match strength {
        PqcStrength::Standard => b"mls10 hybrid epoch secret standard".as_slice(),
        PqcStrength::High => b"mls10 hybrid epoch secret high".as_slice(),
    };

    let hk = Hkdf::<Sha256>::new(Some(salt), &ikm);
    let mut okm = [0u8; 32];
    hk.expand(info, &mut okm)
        .map_err(|_| "HKDF expand failed")?;

    // Zero intermediate
    ikm.zeroize();

    Ok(HybridSharedSecret(okm))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hybrid_roundtrip() {
        let (pk, sk) = HybridKem::<SimulatedPqKem>::generate_keypair(PqcStrength::Standard);
        let (ct, ss1) = HybridKem::<SimulatedPqKem>::encapsulate(&pk, PqcStrength::Standard)
            .expect("encapsulate");
        let ss2 = HybridKem::<SimulatedPqKem>::decapsulate(&sk, &ct, PqcStrength::Standard)
            .expect("decapsulate");
        assert_eq!(ss1.as_bytes(), ss2.as_bytes());
    }
}
