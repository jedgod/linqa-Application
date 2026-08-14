use sha2::{Digest, Sha256};

const DOMAIN: &[u8] = b"linqa:safety-number:v1";

pub fn derive_safety_number(
    local_user_id: &str,
    local_identity_key: &[u8; 32],
    remote_user_id: &str,
    remote_identity_key: &[u8; 32],
) -> String {
    let mut pairs = [
        (local_user_id.as_bytes(), local_identity_key.as_slice()),
        (remote_user_id.as_bytes(), remote_identity_key.as_slice()),
    ];
    pairs.sort_by(|a, b| a.0.cmp(b.0));

    let mut hash = Sha256::new();
    hash.update(DOMAIN);
    for (user, key) in pairs {
        hash.update((user.len() as u32).to_be_bytes());
        hash.update(user);
        hash.update(key);
    }

    let digest = hash.finalize();
    digest
        .chunks(5)
        .take(12)
        .map(|chunk| {
            let mut value = 0u64;
            for byte in chunk {
                value = (value << 8) | *byte as u64;
            }
            format!("{:05}", value % 100_000)
        })
        .collect::<Vec<_>>()
        .join(" ")
}
