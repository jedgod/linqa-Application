# Linqa Protocol Overview

## Design Principles

1. Default end-to-end encryption for **all** conversation types.
2. Scalable group cryptography via MLS (RFC 9420).
3. Hybrid post-quantum security with ongoing ratcheting.
4. Strong metadata minimization (sealed sender + phone-free identity).
5. Clean multi-device support without sacrificing FS/PCS.

## Conversation Types

| Type              | Encryption                  | Notes                                      |
|-------------------|-----------------------------|--------------------------------------------|
| 1:1 Chat          | MLS pairwise or optimized ratchet | Full E2EE + sealed sender                 |
| Group             | MLS                         | Supports large dynamic membership          |
| Channel/Broadcast | MLS                         | Admin-controlled, large audience           |
| Calls (audio/video) | MLS-derived or dedicated media keys | E2EE by default                        |
| Bots              | MLS or authenticated channel | Clear security boundary                   |

## Key Components

### Messaging Layer Security (MLS)
- Primary mechanism for groups and channels.
- TreeKEM (or successor) for efficient member management.
- Hybrid cipher suites that include post-quantum KEMs.
- Epoch updates for forward secrecy and post-compromise security.

### Post-Quantum Hybrid Constructions
- Session establishment: classical ECDH + ML-KEM (Kyber).
- Ongoing ratcheting: hybrid ratchet (inspired by Signal SPQR / Triple Ratchet concepts adapted to MLS epochs).
- Goal: “harvest now, decrypt later” fails even against future quantum computers.

### Sealed Sender
- Sender identity is encrypted so that delivery servers cannot see who is talking to whom in the common case.
- Compatible with MLS application messages.

### Identity System
- Primary identifier: randomly generated ID or user-chosen username.
- No mandatory phone number or email.
- Optional linking of phone/email for discoverability only.
- Key Directory: public, auditable log of identity → public key mappings (transparency).

### Multi-Device
- Device linking: QR code + cryptographic challenge or temporary device transfer key.
- Each device maintains its own leaf in the MLS tree or equivalent.
- History transfer is end-to-end encrypted.
- Primary phone does not need to remain online.

### Authentication & Verification
- Safety numbers / key fingerprints.
- Automatic detection and user notification of key changes.
- Support for out-of-band verification.

## Message Flow (Simplified)

1. Client authenticates to server with identity credentials (no phone required).
2. Client fetches/updates public keys from Key Directory.
3. For a new group/channel: initiator creates MLS group, invites members via encrypted Welcome messages.
4. Messages are encrypted under the current MLS epoch secret (or pairwise ratchet).
5. Delivery uses sealed-sender envelopes so relays learn minimal information.
6. Recipients decrypt using their local MLS state / ratchet state.

## Future Extensions

- Formal verification of critical paths.
- Optional local-only AI features (never leave device).
- Deniable authentication modes.
- Advanced cover traffic / padding for residual traffic analysis resistance.

Detailed specifications will live in the `protocol/` subdirectories as they are written.
