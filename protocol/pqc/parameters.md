# Concrete Post-Quantum Parameters for Linqa

## Design Goals

- Hybrid security: classical security remains even if the post-quantum assumption is broken, and vice versa.
- Ongoing ratcheting / epoch updates that stay post-quantum secure (not only the initial handshake).
- Acceptable bandwidth and CPU cost on modern mobile devices (2024–2026 hardware).
- Alignment with NIST standards and production systems (Signal SPQR, Apple PQ3, MLS PQC drafts).

## Recommended Algorithms (2026)

| Purpose                    | Algorithm              | NIST Name     | Primary Parameter Set | Notes |
|---------------------------|------------------------|---------------|-----------------------|-------|
| Key Encapsulation         | Kyber                  | ML-KEM        | ML-KEM-768            | Best size/security trade-off |
| Key Encapsulation (high)  | Kyber                  | ML-KEM        | ML-KEM-1024           | Optional higher margin |
| Digital Signatures        | Dilithium              | ML-DSA        | ML-DSA-65             | Default for most uses |
| Digital Signatures (high) | Dilithium              | ML-DSA        | ML-DSA-87             | Higher security level |
| Classical companion       | X25519 / X448          | —             | X25519 (preferred)    | Hybrid with ML-KEM |
| AEAD                      | ChaCha20-Poly1305      | —             | —                     | Or AES-256-GCM |
| KDF / Hash                | SHA-256 / SHA-384      | —             | —                     | HKDF-SHA256 primary |

### Why ML-KEM-768 as Default
- Security level roughly matching AES-192.
- Public key ~1.1 KB, ciphertext ~1.1 KB — manageable on mobile.
- Widely implemented and performance-tested.
- ML-KEM-1024 is available as a compile-time or runtime option for users/organizations that demand higher margins.

## Hybrid Construction

Linqa never uses pure post-quantum or pure classical for long-term secrets.

**Hybrid KEM** (for epoch secrets and initial key agreement):
```
shared_secret = KDF(
    classical_shared || pq_shared || transcript
)
```
Where:
- `classical_shared` comes from X25519 (or X448)
- `pq_shared` comes from ML-KEM-768 encapsulation
- Both must be valid for the hybrid secret to be accepted

This matches the philosophy of Signal’s PQXDH + SPQR and Apple’s PQ3.

## Integration with MLS Epochs

1. **Ciphersuite** definition includes both classical and ML-KEM components.
2. Every leaf Update contributes both a classical DH key pair and an ML-KEM key pair (or encapsulation) as required by the suite.
3. The MLS key schedule’s `Extract` / `Expand` steps are fed the hybrid shared secret.
4. Application secrets, exporter secrets, and confirmation keys are all derived from the hybrid epoch secret.

## Integration with 1:1 / Lightweight Ratchets

For pure 1:1 conversations (if not using MLS pairwise):
- Use a Triple-Ratchet-style construction:
  - Classical Double Ratchet (DH + symmetric)
  - Parallel Sparse Post-Quantum Ratchet (SPQR-inspired) using ML-KEM
  - Final message key = KDF(classical_msg_key || pq_msg_key)
- This provides continuous post-quantum forward secrecy and post-compromise security with low average bandwidth (chunking / sparse updates).

## Bandwidth Budget (Approximate)

| Operation                     | Extra PQ Overhead (ML-KEM-768) |
|-------------------------------|--------------------------------|
| Initial KeyPackage            | ~1.2–1.5 KB                    |
| Welcome / Commit (per update) | ~1.1–2.5 KB depending on tree  |
| Regular application message   | 0 B (keys already established) |
| Forced epoch rotation         | Similar to a Commit            |

Clients should aggressively cache ratchet tree nodes and only transmit the necessary path/sibling nodes.

## Implementation Libraries (Rust)

- `ml-kem` / `kyber` crates (or libcrux)
- `ml-dsa` / `dilithium` crates
- Hybrid helpers that enforce “both must succeed”
- Integration into OpenMLS via custom ciphersuite

## Migration & Agility

- Ciphersuites are versioned.
- Clients advertise supported suites in KeyPackages.
- Group creator / admins choose the suite at group creation; later upgrades are possible via epoch change with suite negotiation.
- Deprecated suites can be refused by modern clients.

## Security Levels Summary

| Mode              | Classical          | Post-Quantum       | Hybrid Strength          |
|-------------------|--------------------|--------------------|--------------------------|
| Default           | X25519             | ML-KEM-768         | ≈ AES-128/192 classical + PQ |
| High              | X448 or X25519     | ML-KEM-1024        | Higher PQ margin         |
| Signatures        | Ed25519 (optional) | ML-DSA-65 / 87     | Hybrid or pure PQ        |

## Open Items
- Exact ciphersuite identifiers (IANA / private range)
- Precise hybrid KDF transcript format
- Whether to require ML-DSA for all Commits or allow classical signatures in early epochs
- Performance benchmarks on mid-range Android / iOS devices (to be measured)

These parameters are the recommended starting point for Linqa’s first production ciphersuites.
