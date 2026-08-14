# Linqa Architecture Overview

## High-Level Goals

Linqa aims to deliver a messaging experience that is:
- Secure by default for every conversation type (including large groups and channels)
- Quantum-resistant from day one
- Strongly protective of metadata and identity
- Seamless across multiple devices
- Fully open and independently auditable

## System Components

### 1. Clients
- **Mobile**: Android (Kotlin + Rust core via FFI), iOS (Swift + Rust)
- **Desktop**: Electron / Tauri or native (Rust + UI framework)
- **Web**: Progressive Web App with WebAssembly crypto core (limited feature set for security)

All clients share the same cryptographic core and protocol implementation.

### 2. Cryptographic Core (`core/`)
Written primarily in Rust for memory safety and auditability.
- MLS group management (OpenMLS or equivalent + custom extensions)
- Hybrid post-quantum ratchets
- Sealed-sender primitives
- Local encrypted storage (SQLCipher / SQLCipher-equivalent + hardware-backed keys where available)
- Multi-device key synchronization protocol

### 3. Protocol Layer (`protocol/`)
- **MLS**: Primary group and channel encryption (RFC 9420 + PQC hybrid suites)
- **1:1**: Can fall back to optimized Double/Triple Ratchet style or pure MLS pairwise
- **Identity**: Random IDs / usernames + optional anonymous modes. No mandatory phone number.
- **Sealed Sender**: Sender identity hidden from servers by default
- **Key Directory**: Public key transparency log (auditable)

### 4. Server Infrastructure (`server/`)
Designed for minimal trust and minimal data retention.
- **API Gateway**: Authentication, rate limiting, push notifications
- **Key Directory**: Append-only, auditable public key store with transparency
- **Relay / Delivery**: Handles sealed-sender delivery; does not see plaintext or full relationship graphs
- **Storage**: Only encrypted blobs or ephemeral data where necessary. No message content readable by operators.

Servers never hold long-term decryption keys for user content.

### 5. Multi-Device Model
- Device linking via QR + cryptographic verification or temporary transfer keys
- Full history sync under E2EE
- Primary device not required to stay online
- Each linked device maintains its own ratchet state where appropriate; group state is synchronized securely

### 6. Identity & Recovery
- Primary identity: random ID or username
- Optional recovery: passphrase + social recovery or hardware key
- Phone number / email can be linked optionally for discoverability but is never required

## Trust Boundaries

- Clients are fully trusted (user controls the device)
- Servers are untrusted for content and relationship metadata
- Key Directory is publicly auditable
- Cryptographic core is the single source of truth for security guarantees

## Technology Preferences (Initial)

| Layer              | Preferred Stack                          |
|--------------------|------------------------------------------|
| Crypto Core        | Rust (OpenMLS, libcrux / pqcrypto, etc.) |
| Mobile Android     | Kotlin + Rust FFI                        |
| Mobile iOS         | Swift + Rust (via UniFFI or similar)     |
| Desktop            | Tauri or native Rust + UI                |
| Server             | Rust or Go                               |
| Key Transparency   | Merkle tree / transparency log           |
| Local Storage      | Encrypted SQLite / SQLCipher             |

## Security Properties Guaranteed

- End-to-end encryption by default for all conversation types
- Forward secrecy
- Post-compromise security
- Post-quantum hybrid security (classical + ML-KEM)
- Sealed sender (sender identity hidden from server)
- Minimal metadata retention
- No mandatory phone number

See `docs/security.md` and `docs/protocol.md` for formal properties.
