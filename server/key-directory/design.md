# Linqa Key Directory & Transparency Log Design

## Purpose

The Key Directory is the public, auditable mapping from:

- IdentityId → set of Device KeyPackages
- Optional username → IdentityId

It is the root of trust for authenticating users and devices without requiring phone numbers.

## Threat Model

An adversary who controls the Key Directory server (or coerces the operator) must still be unable to:

- Silently replace a user’s KeyPackages without detection
- Equivocate (show different versions of the directory to different clients)
- Retroactively change historical KeyPackage bindings

## Design: Transparency Log (Merkle Tree)

We use an append-only Merkle tree (or a more advanced structure such as a verifiable log / Trillian-style) with the following properties:

1. **Append-only**: New KeyPackage updates are only appended; old entries are never deleted or mutated in place.
2. **Public auditability**: Anyone can download the log and verify consistency.
3. **Efficient proofs**:
   - **Inclusion proof**: “This KeyPackage is in the log at position X”
   - **Consistency proof**: “The log grew from size S1 to S2 without rewriting history”
4. **Signed tree heads**: The operator periodically signs the current root hash + tree size + timestamp. Clients and auditors verify these signatures.

### Entry Format (simplified)

```
KeyDirectoryEntry {
    identity_id: IdentityId,
    device_id: DeviceId,
    key_package: bytes,          // MLS KeyPackage (hybrid)
    action: Add | Revoke | Update,
    timestamp: u64,
    previous_hash: Option<[u8; 32]>,  // for chain linking if desired
}
```

### Username Mapping

Usernames are also logged as special entries:

```
UsernameEntry {
    username: String,            // normalized
    identity_id: IdentityId,
    timestamp: u64,
}
```

Username claims can be challenged / expired according to policy.

## Client Verification Flow

1. Client fetches the latest signed Tree Head.
2. Client requests an inclusion proof for the expected KeyPackage(s) of a contact.
3. Client verifies the proof against the Tree Head root.
4. Optionally, client (or a background auditor) continuously checks consistency proofs as the log grows.
5. If a KeyPackage changes, the client is notified (key-change warning) and can demand a new inclusion proof.

## Server Components

```
server/key-directory/
├── log/                 # append-only storage + Merkle tree
├── api/                 # gRPC / HTTP endpoints
│   ├── get_tree_head
│   ├── get_inclusion_proof
│   ├── get_consistency_proof
│   ├── submit_update      # authenticated by the identity’s signature
│   └── lookup_identity / lookup_username
├── signer/              # Tree Head signing key (HSM recommended)
└── auditor/             # optional public auditor interface
```

## Privacy Considerations

- The log is public by design (transparency).
- IdentityIds can be random / non-correlatable.
- Clients should not be forced to reveal their own IdentityId to the directory when only looking up others (use PIR or careful query design where feasible).
- Rate limiting and proof-of-work / authentication for updates prevent spam.

## Recovery & Revocation

- A user can publish a Revoke entry for a lost device (signed by another still-valid device or by a recovery key).
- After revocation, new groups will not accept the revoked KeyPackage.
- Existing groups remove the leaf via normal MLS Remove.

## Comparison with Existing Systems

| System              | Approach                     | Linqa Choice              |
|---------------------|------------------------------|---------------------------|
| Signal              | Private contact discovery + limited transparency | Full public log          |
| WhatsApp            | Key Directory + Cloudflare auditor | Similar, fully open      |
| Key Transparency (KT) / CONIKS / SEEMless | Academic designs | Practical Merkle log     |
| Certificate Transparency | Public logs for TLS     | Same philosophy          |

## Implementation Notes

- Start with a simple in-memory / SQLite-backed Merkle tree for the prototype.
- Move to a production-grade verifiable log (e.g. based on Trillian or a pure-Rust equivalent) before public beta.
- Tree Head signing key should be protected by an HSM or secure enclave.
- Multiple independent auditors are encouraged.

## Open Questions

- Exact signature algorithm for Tree Heads (ML-DSA recommended long-term).
- How frequently Tree Heads are published (every few minutes vs. on every update).
- Support for “private” identities that do not appear in the public log (advanced anonymity mode).
- Cross-server federation of logs (future).
