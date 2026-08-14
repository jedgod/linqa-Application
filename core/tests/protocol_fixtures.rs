use linqa_core::protocol::{
    envelope_v1::{EnvelopeError, ProtocolEnvelopeV1},
    hybrid_ciphertext_v1::HybridCiphertextV1,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenFixture {
    encoded_length: usize,
    sha256: String,
}

fn fixture() -> ProtocolEnvelopeV1 {
    ProtocolEnvelopeV1::new(
        [1; 16],
        [2; 32],
        1_700_000_000,
        1_700_086_400,
        [3; 32],
        [4; 12],
        HybridCiphertextV1::from_parts([5; 32], vec![6; 1088]).unwrap(),
        vec![7; 128],
        vec![8; 256],
        [9; 64],
    )
    .unwrap()
}

#[test]
fn fixture_round_trip_is_byte_stable() {
    let encoded = fixture().encode().unwrap();
    let golden: GoldenFixture = serde_json::from_str(include_str!(
        "../../tests/protocol-fixtures/envelope-v1.json"
    ))
    .unwrap();
    assert_eq!(encoded.len(), golden.encoded_length);
    assert_eq!(format!("{:x}", Sha256::digest(&encoded)), golden.sha256);
    let decoded = ProtocolEnvelopeV1::decode(&encoded).unwrap();
    assert_eq!(decoded, fixture());
    assert_eq!(decoded.encode().unwrap(), encoded);
}

#[test]
fn fixture_rejects_trailing_and_malformed_bytes() {
    let mut trailing = fixture().encode().unwrap();
    trailing.push(0);
    assert_eq!(
        ProtocolEnvelopeV1::decode(&trailing),
        Err(EnvelopeError::Invalid)
    );
    assert!(ProtocolEnvelopeV1::decode(&[0, 1, 2]).is_err());
}

#[test]
fn fixture_rejects_unsupported_version() {
    let mut encoded = fixture().encode().unwrap();
    encoded[5] = 2;
    assert_eq!(
        ProtocolEnvelopeV1::decode(&encoded),
        Err(EnvelopeError::UnsupportedVersion)
    );
}

#[test]
fn fixture_rejects_expired_envelope() {
    assert_eq!(
        fixture().validate_at(1_700_086_401),
        Err(EnvelopeError::Expired)
    );
}
