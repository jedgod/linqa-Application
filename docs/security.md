# Linqa Security Model

## Threat Model

We assume a powerful adversary that can:
- Control the network (passive and active)
- Compromise servers (API, key directory, relays)
- Perform long-term traffic analysis and storage of ciphertext (“harvest now, decrypt later”)
- Compromise individual user devices (with limited time)
- Attempt quantum attacks in the future

We do **not** assume protection against a fully compromised client device while the user is actively using it, or against sophisticated physical side-channel attacks on the device itself.

## Core Guarantees

### 1. Confidentiality
All message content, media, and call media are end-to-end encrypted. Servers cannot read content.

### 2. Forward Secrecy
Compromising a long-term or current session key does not allow decryption of past messages.

### 3. Post-Compromise Security
After a temporary compromise of a device or key, the protocol can recover security for future messages once the compromised party participates honestly again (or is removed from groups).

### 4. Post-Quantum Security
Hybrid constructions using NIST-standardized algorithms (ML-KEM for key encapsulation, ML-DSA where signatures are needed) protect against both classical and quantum adversaries. Ongoing ratcheting (not only session setup) is required.

### 5. Authentication
Participants can verify the identity of peers via safety numbers / key fingerprints and automatic key-change detection. Key Directory transparency helps detect malicious key injection.

### 6. Metadata Protection
- Sealed sender hides the sender identity from the delivery servers in the common case.
- No mandatory phone numbers.
- Relationship graphs are minimized; servers should not be able to build long-term social graphs easily.
- Timing and traffic analysis remain a residual risk (mitigated by padding, cover traffic options, and careful design where feasible).

### 7. Deniability (where useful)
Support for deniable authentication in 1:1 contexts where it does not conflict with other goals.

## Group & Channel Security (MLS)

- Efficient tree-based key agreement for large membership.
- Epoch-based updates provide rapid rotation of group secrets.
- Compromised members can be removed with post-compromise security for the remaining group.
- Channels/broadcasts use the same cryptographic primitives with appropriate access control.

## Multi-Device Considerations

- Each device holds its own private keys.
- Linking a new device requires cryptographic verification (QR or equivalent).
- History is transferred under encryption.
- Compromising one device does not automatically compromise all other devices indefinitely (PCS applies).

## Client-Side Protections

- Local database encrypted at rest with user passphrase or hardware-backed keys.
- View-once / self-destructing messages.
- Optional screenshot / screen-recording warnings (platform-dependent).
- Resistance to casual physical seizure via strong local encryption and optional remote wipe / panic modes.

## Openness & Verification

- Cryptographic core and clients will be fully open source.
- Regular independent security audits.
- Formal verification of critical protocol components where practical.
- Transparent, minimal data retention policy.

## Residual Risks

- Traffic analysis and timing correlation.
- Compromised client devices.
- Social engineering and phishing of recovery material.
- Implementation bugs (mitigated by audits, formal methods, and memory-safe languages).

This document will evolve as the protocol is refined.
