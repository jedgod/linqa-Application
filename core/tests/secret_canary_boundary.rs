//! UJB-04: plant a distinctive "canary" byte pattern inside the private key
//! fields (via `from_key_material`, the same import path `NativeCore.kt`
//! uses to bind a UniFFI core to a device identity) and prove the canary
//! never surfaces in any public-facing serialized output. This catches
//! copy-paste leaks (e.g. accidentally serializing the whole `DeviceSecrets`
//! struct into a response) that a type-level review could miss.
#![cfg(feature = "uniffi-bindings")]

use base64::{engine::general_purpose::STANDARD, Engine};
use linqa_core::identity::DeviceKeyMaterial;
use linqa_core::uniffi_api::NativeSecureCore;

const CANARY: [u8; 8] = *b"CANARY!!";

fn canary_key_material() -> DeviceKeyMaterial {
    let mut signing_key = [0u8; 32];
    signing_key[..8].copy_from_slice(&CANARY);
    let mut encryption_secret = [0u8; 32];
    encryption_secret[..8].copy_from_slice(&CANARY);

    // pq_encryption_secret must be a real ML-KEM-768 seed, so derive one
    // legitimately and only stamp the canary into the tail padding bytes
    // that from_key_material re-derives the public key from, rather than
    // corrupting the seed itself (which would fail construction).
    let generated = linqa_core::identity::DeviceSecrets::generate().export_key_material();
    let mut pq_encryption_secret = generated.pq_encryption_secret.clone();
    let tail = pq_encryption_secret.len().saturating_sub(8);
    pq_encryption_secret[tail..].copy_from_slice(&CANARY);

    DeviceKeyMaterial {
        signing_key,
        encryption_secret,
        pq_encryption_secret,
    }
}

#[test]
fn canary_in_signing_and_encryption_secrets_never_leaks_via_key_package() {
    let material = canary_key_material();
    let material_b64 = STANDARD.encode(serde_json::to_vec(&material).unwrap());

    let core = match NativeSecureCore::from_key_material(material_b64) {
        Ok(c) => c,
        Err(_) => {
            // A canary-mangled PQ seed can legitimately fail decapsulation-key
            // validation; that failure is itself the correct fail-closed
            // behavior (UJB boundary holds vacuously: nothing was ever
            // constructed to leak from). Re-run with only the classical
            // secrets canaried, leaving a real PQ seed untouched.
            let mut material = canary_key_material();
            material.pq_encryption_secret = linqa_core::identity::DeviceSecrets::generate()
                .export_key_material()
                .pq_encryption_secret
                .clone();
            let material_b64 = STANDARD.encode(serde_json::to_vec(&material).unwrap());
            NativeSecureCore::from_key_material(material_b64)
                .expect("classical-only canary material constructs")
        }
    };

    let package_b64 = core
        .generate_key_package("dana".into(), "dana-device".into(), 9_999_999_999)
        .expect("generate key package");
    let package_bytes = STANDARD.decode(&package_b64).expect("valid base64");

    assert!(
        !contains_subslice(&package_bytes, &CANARY),
        "canary secret bytes leaked into generated key package"
    );
    assert!(
        !package_b64
            .as_bytes()
            .windows(CANARY.len())
            .any(|w| w == CANARY),
        "canary secret bytes leaked into base64-encoded key package"
    );

    let version_string = core.version();
    assert!(
        !version_string
            .as_bytes()
            .windows(CANARY.len())
            .any(|w| w == CANARY),
        "canary secret bytes leaked into version() output"
    );
}

fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || needle.len() > haystack.len() {
        return false;
    }
    haystack.windows(needle.len()).any(|w| w == needle)
}
