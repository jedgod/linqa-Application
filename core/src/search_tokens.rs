use crate::error::{LinqaError, Result};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::collections::BTreeSet;

type HmacSha256 = Hmac<Sha256>;
const DOMAIN: &[u8] = b"linqa:local-search:v1";

pub fn normalize_terms(input: &str) -> Vec<String> {
    input
        .split(|c: char| !c.is_alphanumeric())
        .filter_map(|term| {
            let normalized = term.trim().to_lowercase();
            (normalized.len() >= 2).then_some(normalized)
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub fn derive_search_tokens(index_key: &[u8; 32], input: &str) -> Result<Vec<[u8; 32]>> {
    let mut tokens = Vec::new();

    for term in normalize_terms(input) {
        let mut mac =
            HmacSha256::new_from_slice(index_key).map_err(|_| LinqaError::CryptoFailure)?;
        mac.update(DOMAIN);
        mac.update(term.as_bytes());
        tokens.push(mac.finalize().into_bytes().into());
    }

    Ok(tokens)
}
