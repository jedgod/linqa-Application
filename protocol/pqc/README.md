# Post-Quantum Cryptography in Linqa

## Requirements
- Hybrid classical + post-quantum key agreement for all sessions
- Ongoing ratcheting / epoch updates that remain post-quantum secure
- NIST-standardized algorithms (ML-KEM for KEMs, ML-DSA for signatures where needed)

## Preferred Parameters (initial)
- ML-KEM-768 (or ML-KEM-1024 for higher security margin) hybridized with X25519 / X448
- ML-DSA-65 / ML-DSA-87 where signatures are required

## Goals
- Defeat “harvest now, decrypt later” attacks even against future cryptographically relevant quantum computers
- Keep bandwidth and computational overhead acceptable for mobile devices
- Integrate cleanly with MLS epochs and any 1:1 ratchet

References: Signal PQXDH + SPQR/Triple Ratchet, Apple iMessage PQ3, IETF MLS PQC drafts.
