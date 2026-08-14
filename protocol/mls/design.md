# MLS Design for Linqa

## Why MLS

Classic Signal Protocol sender-keys (and pairwise Double Ratchet) scale poorly for large, dynamic groups:

- Adding or removing a member typically requires O(n) operations or full rekeying cost that grows linearly.
- Practical limits appear around ~1,000 members for good latency and battery life.
- Post-compromise security and forward secrecy degrade or become expensive as membership churn increases.

**Messaging Layer Security (RFC 9420)** solves this with a tree-based key agreement (TreeKEM and successors):

- Member add/remove and epoch updates cost O(log n).
- Designed for groups up to tens of thousands of members.
- Native support for multi-device (each device can be a leaf).
- Clean epoch model that delivers both forward secrecy and post-compromise security.
- Already shipping in production systems (RCS Universal Profile 3.0, Discord, Wire, Matrix migration path, etc.).

Linqa uses MLS as the **primary** mechanism for groups and channels. 1:1 conversations may use an optimized MLS pairwise mode or a lightweight hybrid ratchet for maximum efficiency.

## Core Concepts Used by Linqa

### Group State
- **Ratchet Tree**: Binary tree where leaves represent members (or devices). Each node holds a secret that is known only to the subtree below it.
- **Epoch**: A discrete version of the group state. Every membership change or periodic refresh advances the epoch and derives a new group secret.
- **Welcome Message**: Encrypted package that allows a new member to join an existing epoch securely.
- **Commit**: Message that proposes and applies changes (add, remove, update) and advances the epoch.
- **Proposal**: Individual change (add/remove/update) that can be batched into a Commit.

### Security Properties Delivered
- **Forward Secrecy**: Past epochs cannot be decrypted after the group secret rotates.
- **Post-Compromise Security**: After a member is compromised and later removed (or after an Update from an honest member), future epochs are secure again.
- **Authentication**: Every Commit is authenticated; members can verify the tree integrity.
- **Confidentiality of membership operations**: Sensitive parts of the tree can be protected.

## Hybrid Post-Quantum Integration

Linqa requires hybrid classical + post-quantum security for every epoch.

Recommended approach (aligned with ongoing IETF work and production systems):

1. **Cipher Suite**: Define Linqa hybrid ciphersuites that combine:
   - Classical: X25519 or X448
   - Post-quantum: ML-KEM-768 (primary) or ML-KEM-1024
   - AEAD: ChaCha20-Poly1305 or AES-256-GCM
   - Hash: SHA-256 / SHA-384 / SHA-512 as appropriate
   - Signature: ML-DSA-65 or hybrid classical + ML-DSA where needed

2. **Key Schedule**: The MLS key schedule is extended so that the epoch secret is derived from both classical and post-quantum material. A hybrid KDF combines the two.

3. **Leaf Updates**: When a member performs an Update, they contribute both a classical DH share and an ML-KEM encapsulation / key pair as required by the ciphersuite.

4. **Bandwidth Considerations**: ML-KEM public keys and ciphertexts are larger than X25519. Linqa will:
   - Prefer ML-KEM-768 for the best size/security trade-off on mobile.
   - Use sparse or chunked transmission techniques where beneficial (inspired by Signal SPQR).
   - Cache tree nodes aggressively on clients.

## Group & Channel Lifecycle in Linqa

### Creating a Group / Channel
1. Creator generates a fresh MLS group with chosen ciphersuite.
2. Creator is the sole initial member (leaf 0).
3. Group ID and initial epoch secret are established.
4. For channels, additional access-control metadata (admin list, posting permissions) is attached as application data.

### Adding Members
1. Existing member (usually admin) creates an Add proposal containing the new member’s KeyPackage.
2. KeyPackage is fetched from the Linqa Key Directory (transparency log).
3. Commit is generated; new epoch begins.
4. Welcome message is sent to the new member (encrypted under their KeyPackage).
5. New member processes Welcome and joins the new epoch.

### Removing Members
1. Remove proposal is created.
2. Commit advances the epoch; the removed member’s leaf is blanked.
3. Remaining members update their local tree.
4. Post-compromise security is restored for the group once the Commit is processed.

### Periodic Epoch Rotation
Even without membership changes, Linqa clients periodically force an Update + Commit (e.g., every N messages or every T hours) to strengthen forward secrecy and limit the window of a potential compromise.

### Multi-Device Representation
Each physical device of a user is a separate leaf in the MLS tree (or a tightly managed subtree). This gives clean per-device forward secrecy and simplifies linking / unlinking devices.

## Server Role (Minimal Trust)

The Linqa delivery / relay servers:
- Store and forward MLS handshake messages (Commits, Proposals, Welcomes) and application messages.
- Do **not** need to understand the ratchet tree contents.
- May assist with fan-out for large groups, but cryptographic verification remains client-side.
- Key Directory provides the KeyPackages; it is publicly auditable.

## Implementation Notes

- Primary library: **OpenMLS** (Rust) — already audited and used in production systems.
- Alternatives / complements: mls-rs (AWS), MLS++.
- Linqa will maintain thin wrappers for:
  - Hybrid ciphersuite registration
  - Application-specific extensions (channel permissions, sealed-sender binding, etc.)
  - Efficient tree caching and persistence
- All group state is stored encrypted at rest on the client.

## Open Design Decisions (to be finalized)

1. Exact hybrid ciphersuite identifiers and parameter sets.
2. Whether 1:1 chats use pure MLS or a lighter pairwise ratchet that still benefits from the same PQC primitives.
3. Policy for forced epoch rotation frequency vs. battery / bandwidth cost.
4. How aggressively to blank and rebalance the tree after mass removals.
5. Federation / multi-server support (MLS is designed to allow it).

## References
- RFC 9420 – The Messaging Layer Security (MLS) Protocol
- RFC 9750 – MLS Architecture
- OpenMLS documentation and audits
- IETF drafts on post-quantum MLS
- Signal Triple Ratchet / SPQR papers (for hybrid ratcheting inspiration)
- Apple PQ3 and RCS MLS deployments (2025–2026)
