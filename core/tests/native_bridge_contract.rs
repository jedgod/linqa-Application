//! The JSON the app's JavaScript sends across the native bridge (clients/mobile/services/secure-core.ts) must be exactly what the
//! core reads. This drives the same exported object the Android module binds to (`NativeSecureCore`), with the same shapes:
//! key material built from enrolled keys plus a separately drawn post-quantum seed, one envelope per recipient device, and a
//! decrypt request that names the recipient device and the sender's signing key.
#![cfg(feature = "uniffi-bindings")]

use base64::{engine::general_purpose::STANDARD, Engine};
use linqa_core::uniffi_api::NativeSecureCore;
use serde_json::{json, Value};

const USER_A: &str = "00000000-0000-4000-8000-0000000000a1";
const USER_B: &str = "00000000-0000-4000-8000-0000000000b2";
const DEVICE_A: &str = "10000000-0000-4000-8000-0000000000a1";
const DEVICE_B: &str = "10000000-0000-4000-8000-0000000000b2";

fn b64_json(value: &Value) -> String {
    STANDARD.encode(serde_json::to_vec(value).unwrap())
}
fn from_b64_json(b64: &str) -> Value {
    serde_json::from_slice(&STANDARD.decode(b64).unwrap()).unwrap()
}

/// What the app does: a throwaway core supplies a post-quantum seed; the enrolled signing and encryption keys are kept.
fn device_core(signing: u8, encryption: u8) -> std::sync::Arc<NativeSecureCore> {
    let drawn = from_b64_json(
        &NativeSecureCore::new()
            .unwrap()
            .export_key_material()
            .unwrap(),
    );
    let material = json!({ "signing_key": vec![signing; 32], "encryption_secret": vec![encryption; 32], "pq_encryption_secret": drawn["pq_encryption_secret"] });
    NativeSecureCore::from_key_material(b64_json(&material))
        .expect("core from app-built key material")
}

fn now() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

fn package(core: &NativeSecureCore, user: &str, device: &str) -> Value {
    // The app passes milliseconds; the core accepts either.
    let b64 = core
        .generate_key_package(
            user.into(),
            device.into(),
            ((now() + 14 * 86_400) * 1000) as u64,
        )
        .unwrap();
    core.verify_key_package(b64.clone())
        .expect("a package the core made verifies");
    from_b64_json(&b64)
}

fn encrypt_to(
    sender: &NativeSecureCore,
    from: (&str, &str),
    to: &Value,
    message_id: &str,
    plaintext: &[u8],
) -> Value {
    let request = json!({
        "recipient_encryption_public_key": to["encryption_public_key"], "recipient_pq_encryption_public_key": to["pq_encryption_public_key"],
        "sender_user_id": from.0, "sender_device_id": from.1, "recipient_user_id": to["user_id"], "recipient_device_id": to["device_id"],
        "message_id": message_id, "plaintext": plaintext.to_vec(), "created_at_unix": now(), "expires_at_unix": now() + 10 * 365 * 86_400
    });
    from_b64_json(
        &sender
            .encrypt_message(request.to_string())
            .expect("encrypt with the app's request shape"),
    )
}

fn decrypt_as(
    recipient: &NativeSecureCore,
    device: &str,
    sender_pkg: &Value,
    envelope: &Value,
) -> Result<Vec<u8>, String> {
    let request = json!({ "expected_recipient_device_id": device, "sender_signing_public_key": sender_pkg["signing_public_key"], "envelope": envelope, "now_unix": now() });
    recipient
        .decrypt_message(b64_json(&request))
        .map(|b64| STANDARD.decode(b64).unwrap())
        .map_err(|e| format!("{e:?}"))
}

#[test]
fn a_message_sealed_the_way_the_app_does_it_opens_on_the_recipient_and_on_the_sender() {
    let (a, b) = (device_core(1, 2), device_core(3, 4));
    let (pkg_a, pkg_b) = (package(&a, USER_A, DEVICE_A), package(&b, USER_B, DEVICE_B));

    let inner: &[u8] = r#"{"v":1,"c":"conv","s":"alice","t":"hello é世界"}"#.as_bytes();
    let for_b = encrypt_to(&a, (USER_A, DEVICE_A), &pkg_b, "msg-1", inner);
    let for_a = encrypt_to(&a, (USER_A, DEVICE_A), &pkg_a, "msg-1", inner);

    assert_eq!(decrypt_as(&b, DEVICE_B, &pkg_a, &for_b).unwrap(), inner);
    assert_eq!(decrypt_as(&a, DEVICE_A, &pkg_a, &for_a).unwrap(), inner);
}

#[test]
fn it_is_refused_when_it_is_for_another_device_from_another_sender_or_replayed() {
    let (a, b, c) = (device_core(1, 2), device_core(3, 4), device_core(5, 6));
    let (pkg_a, pkg_b, pkg_c) = (
        package(&a, USER_A, DEVICE_A),
        package(&b, USER_B, DEVICE_B),
        package(&c, USER_B, "10000000-0000-4000-8000-0000000000c3"),
    );
    let envelope = encrypt_to(&a, (USER_A, DEVICE_A), &pkg_b, "msg-2", b"secret");

    // Another device of the same person cannot open it, and neither can a core under another device id.
    assert!(decrypt_as(
        &c,
        "10000000-0000-4000-8000-0000000000c3",
        &pkg_a,
        &envelope
    )
    .is_err());
    assert!(decrypt_as(
        &b,
        "10000000-0000-4000-8000-0000000000c3",
        &pkg_a,
        &envelope
    )
    .is_err());
    // A different sender key does not verify.
    assert!(decrypt_as(&b, DEVICE_B, &pkg_c, &envelope).is_err());
    // It opens once; opening the same message again is a replay (which is why the app keeps what it has opened).
    assert!(decrypt_as(&b, DEVICE_B, &pkg_a, &envelope).is_ok());
    assert!(decrypt_as(&b, DEVICE_B, &pkg_a, &envelope).is_err());
    let _ = pkg_c;
}

#[test]
fn a_tampered_envelope_does_not_open() {
    let (a, b) = (device_core(1, 2), device_core(3, 4));
    let (pkg_a, pkg_b) = (package(&a, USER_A, DEVICE_A), package(&b, USER_B, DEVICE_B));
    let mut envelope = encrypt_to(&a, (USER_A, DEVICE_A), &pkg_b, "msg-3", b"secret");
    let ct = envelope["ciphertext"]
        .as_array_mut()
        .expect("ciphertext is an array of bytes");
    let last = ct.len() - 1;
    ct[last] = json!((ct[last].as_u64().unwrap() as u8 ^ 1) as u64);
    assert!(decrypt_as(&b, DEVICE_B, &pkg_a, &envelope).is_err());
}

#[test]
fn the_same_key_material_gives_the_same_key_package_identity() {
    // The server checks the package's signing key against the key the device enrolled with.
    let first = package(&device_core(7, 8), USER_A, DEVICE_A);
    let second = package(&device_core(7, 8), USER_A, DEVICE_A);
    assert_eq!(first["signing_public_key"], second["signing_public_key"]);
    assert_eq!(
        first["encryption_public_key"],
        second["encryption_public_key"]
    );
    assert_eq!(first["version"], 2);
    assert_eq!(
        first["pq_encryption_public_key"].as_array().unwrap().len(),
        1184
    );
}

#[test]
fn native_call_key_and_signature_bindings_round_trip() {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    let alice = device_core(21, 22);
    let bob = device_core(31, 32);
    let bob_package = package(&bob, USER_B, DEVICE_B);
    let raw = |v: &Value| {
        v.as_array()
            .unwrap()
            .iter()
            .map(|b| b.as_u64().unwrap() as u8)
            .collect::<Vec<_>>()
    };
    let aad = STANDARD.encode(b"linqa-call-env-v1|key|bob:phone");
    let sealed = alice
        .seal_call_key(
            STANDARD.encode(raw(&bob_package["encryption_public_key"])),
            STANDARD.encode(raw(&bob_package["pq_encryption_public_key"])),
            STANDARD.encode(b"native-call-key"),
            aad.clone(),
        )
        .unwrap();
    assert_eq!(
        STANDARD
            .decode(bob.open_call_key(sealed.clone(), aad.clone()).unwrap())
            .unwrap(),
        b"native-call-key"
    );
    assert!(alice.open_call_key(sealed.clone(), aad).is_err());
    assert!(bob
        .open_call_key(
            sealed,
            STANDARD.encode(b"linqa-call-env-v1|other|bob:phone")
        )
        .is_err());
    let message = b"linqa-call-sig-v1{header-ciphertext}";
    let sig = STANDARD
        .decode(alice.sign_call_message(STANDARD.encode(message)).unwrap())
        .unwrap();
    let alice_package = package(&alice, USER_A, DEVICE_A);
    let public: [u8; 32] = raw(&alice_package["signing_public_key"])
        .try_into()
        .unwrap();
    VerifyingKey::from_bytes(&public)
        .unwrap()
        .verify(message, &Signature::from_slice(&sig).unwrap())
        .unwrap();
    assert!(alice
        .sign_call_message(STANDARD.encode(b"unrelated signing request"))
        .is_err());
}
