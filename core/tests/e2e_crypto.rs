use linqa_core::{
    envelope::{decrypt, encrypt},
    identity::DeviceSecrets,
    replay::ReplayCache,
    LinqaError,
};

#[test]
fn alice_to_bob_round_trip() {
    let alice = DeviceSecrets::generate();
    let bob = DeviceSecrets::generate();
    let alice_public = alice.public_identity();
    let bob_public = bob.public_identity();

    let envelope = encrypt(
        &alice,
        bob_public.encryption_public_key,
        &bob_public.pq_encryption_public_key,
        "alice",
        "alice-phone",
        "bob",
        "bob-phone",
        "018f6bf4-44d5-7e15-a6fa-030f0f6fe001",
        b"hello bob",
        1_700_000_000,
        1_700_000_600,
    )
    .unwrap();

    let mut replay = ReplayCache::new(100).unwrap();
    let plaintext = decrypt(
        &bob,
        "bob-phone",
        alice_public.signing_public_key,
        &envelope,
        1_700_000_010,
        &mut replay,
    )
    .unwrap();

    assert_eq!(plaintext, b"hello bob");
}

#[test]
fn tampering_is_rejected() {
    let alice = DeviceSecrets::generate();
    let bob = DeviceSecrets::generate();
    let bob_public = bob.public_identity();
    let mut envelope = encrypt(
        &alice,
        bob_public.encryption_public_key,
        &bob_public.pq_encryption_public_key,
        "alice",
        "alice-phone",
        "bob",
        "bob-phone",
        "m1",
        b"secret",
        100,
        200,
    )
    .unwrap();
    envelope.ciphertext[0] ^= 1;

    let mut replay = ReplayCache::new(100).unwrap();
    assert!(matches!(
        decrypt(
            &bob,
            "bob-phone",
            alice.public_identity().signing_public_key,
            &envelope,
            150,
            &mut replay,
        ),
        Err(LinqaError::AuthenticationFailed)
    ));
}

#[test]
fn replay_is_rejected() {
    let alice = DeviceSecrets::generate();
    let bob = DeviceSecrets::generate();
    let bob_public = bob.public_identity();
    let envelope = encrypt(
        &alice,
        bob_public.encryption_public_key,
        &bob_public.pq_encryption_public_key,
        "alice",
        "alice-phone",
        "bob",
        "bob-phone",
        "m-replay",
        b"secret",
        100,
        200,
    )
    .unwrap();

    let mut replay = ReplayCache::new(100).unwrap();
    decrypt(
        &bob,
        "bob-phone",
        alice.public_identity().signing_public_key,
        &envelope,
        150,
        &mut replay,
    )
    .unwrap();

    assert!(matches!(
        decrypt(
            &bob,
            "bob-phone",
            alice.public_identity().signing_public_key,
            &envelope,
            150,
            &mut replay,
        ),
        Err(LinqaError::ReplayDetected)
    ));
}
