# Linqa Roadmap

## Phase 0 – Foundation (Current)
- [x] Project structure
- [x] Core architecture & security model documents
- [x] Protocol high-level specification
- [x] Technology decisions (Rust core, client stacks)
- [x] Governance model draft
- [x] Detailed MLS design + hybrid ciphersuite plan
- [x] Concrete PQC parameters
- [x] Multi-device design
- [x] Key Directory / transparency log design
- [x] Sealed-sender credential design
- [x] Rust core scaffolding (traits + module layout)
- [x] UniFFI UDL scaffolding
- [x] CLI prototype skeleton

**Honest status of Phase 0 artifacts:**
- Buildable: **No** (no Rust toolchain in the current environment)
- Functionally runnable: **No** (crypto and transport layers are still stubs)
- Main blockers: missing toolchain + incomplete real crypto implementation (OpenMLS hybrid provider, actual KEMs, seal/open, network)

## Phase 1 – Cryptographic Core
- [ ] Integrate / fork OpenMLS (or equivalent) with hybrid PQC suites
- [ ] Implement hybrid post-quantum ratchet / epoch updates
- [ ] Sealed-sender primitives
- [ ] Local encrypted storage abstraction
- [ ] Basic multi-device key sync prototype
- [ ] Unit & property-based tests for crypto

## Phase 2 – Protocol & Identity
- [ ] Full MLS group lifecycle (create, add, remove, update, leave)
- [ ] Phone-free identity system + Key Directory (transparency log)
- [ ] 1:1 and small-group messaging over the core
- [ ] Safety number / key verification UX
- [ ] Basic server: API + key directory + sealed-sender relay

## Phase 3 – Clients (MVP)
- [ ] Android client (Kotlin + Rust FFI)
- [ ] iOS client (Swift + Rust)
- [ ] Desktop client (minimum viable)
- [ ] Cross-device linking & history transfer
- [ ] Basic group & channel support
- [ ] View-once / disappearing messages

## Phase 4 – Hardening & Scale
- [ ] Large group / channel performance testing & optimization
- [ ] Full multi-device polish (no primary-phone dependency)
- [ ] Independent security audit #1
- [ ] Formal verification of critical protocol pieces
- [ ] Advanced metadata protections & padding
- [ ] Screenshot / local protections

## Phase 5 – Production Readiness
- [ ] Public beta
- [ ] Second independent audit
- [ ] Governance formalization (nonprofit / foundation model preferred)
- [ ] Open-source release of clients + core
- [ ] Documentation for auditors and researchers

## Ongoing
- Continuous security review
- Performance & battery optimization
- Accessibility & internationalization
- Optional local AI features (on-device only)

---

**Guiding Principle**: Security and privacy properties are never traded for short-term growth or convenience features.
