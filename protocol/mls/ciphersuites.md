# Concrete OpenMLS Hybrid Ciphersuite Registration for Linqa

## Goal

Register one or more hybrid post-quantum ciphersuites with OpenMLS so that every MLS group in Linqa uses classical + ML-KEM security by default.

## Recommended Ciphersuites

### 1. Linqa Hybrid Standard (default)

| Component          | Algorithm              | Notes |
|--------------------|------------------------|-------|
| HPKE KEM           | X25519 + ML-KEM-768    | Hybrid |
| HPKE KDF           | HKDF-SHA256            | |
| HPKE AEAD          | ChaCha20-Poly1305      | |
| Signature          | Ed25519 + ML-DSA-65    | Hybrid (or pure ML-DSA-65) |
| Hash               | SHA-256                | |
| MLS Version        | 1.0 (RFC 9420)         | |

**Internal name**: `LINQA_HYBRID_X25519_MLKEM768_CHACHA20POLY1305_SHA256`

### 2. Linqa Hybrid High

Same as above but with ML-KEM-1024 and ML-DSA-87 for higher security margin.

**Internal name**: `LINQA_HYBRID_X25519_MLKEM1024_CHACHA20POLY1305_SHA384`

## OpenMLS Integration Approach

OpenMLS supports custom ciphersuites via the `Ciphersuite` trait / configuration in recent versions.

### Steps to register

1. Define a new `Ciphersuite` constant (private range or experimental).
2. Implement the required crypto provider that:
   - Performs hybrid KEM (X25519 DH + ML-KEM encapsulate/decapsulate)
   - Combines the two shared secrets with a domain-separated KDF
   - Provides hybrid signature verification when required
3. Register the ciphersuite with the OpenMLS crypto provider used by Linqa.
4. Advertise the ciphersuite in every KeyPackage Linqa generates.
5. Reject groups that only offer pure-classical ciphersuites (configurable policy).

### Hybrid KEM Construction (normative for Linqa)

```
classical_ss = X25519(sk_classical, pk_classical)
pq_ss, pq_ct = ML-KEM-768.Encaps(pk_pq)

shared_secret = HKDF-Extract(
    salt = "Linqa-Hybrid-KEM-v1",
    IKM  = classical_ss || pq_ss
)
shared_secret = HKDF-Expand(
    PRK  = shared_secret,
    info = "mls10 hybrid epoch secret" || ciphersuite_id,
    L    = 32
)
```

Both components **must** succeed; otherwise the operation fails closed.

### KeyPackage Extensions

Linqa KeyPackages carry:

- Standard MLS KeyPackage fields
- A `linqa_hybrid_capabilities` extension listing supported hybrid suites
- Optional sealed-sender credential binding

## Code Location

Implementation lives in:

```
core/src/crypto/mls/
├── mod.rs
├── ciphersuite.rs      # registration & hybrid provider
├── hybrid_provider.rs  # concrete CryptoProvider implementation
└── key_package.rs      # Linqa-specific KeyPackage helpers
```

## Policy

- New groups default to the Standard hybrid suite.
- Clients MUST support at least the Standard suite.
- High suite is optional but recommended for high-security groups.
- Pure classical suites are rejected by default (can be enabled for interoperability testing only).

## References

- RFC 9420 §5.1 (Ciphersuites)
- OpenMLS custom ciphersuite documentation
- IETF drafts on post-quantum MLS
- Signal SPQR / Apple PQ3 hybrid constructions (inspiration for the KDF transcript)
