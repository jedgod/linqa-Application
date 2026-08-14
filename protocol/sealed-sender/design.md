# Sealed-Sender Credential Design for Linqa

## Goal

Hide the true sender identity from Linqa delivery / relay servers in the common case, while still allowing the recipient to authenticate the sender cryptographically.

## High-Level Approach

We combine three ideas:

1. **Delivery tokens** – short-lived, server-verifiable tokens that authorize delivery to a recipient without revealing the sender.
2. **Sealed envelopes** – the actual message (MLS ciphertext or application data) is encrypted so that only the recipient can open it and learn the sender.
3. **Credentials** – the sender proves to the recipient (inside the sealed envelope) that they are a legitimate member of the conversation / identity, without the server learning that binding.

## Credential Types

### 1. Group Membership Credential (for MLS groups)

When a user is added to an MLS group they receive (or can derive) a credential that binds:

- Their IdentityId + DeviceId
- The GroupId
- A validity period / epoch range

This credential is included inside the sealed envelope. The recipient verifies it against the current MLS group state (the sender’s leaf exists and is authenticated).

The relay never sees this credential in the clear.

### 2. 1:1 / Direct Credential

For pairwise conversations the sender includes a signature under their long-term identity key (or a delegated device key) over a transcript that includes the recipient’s identity and a freshness nonce. Again, this is only visible after the recipient opens the envelope.

### 3. Anonymous / Unlinkable Mode (advanced)

For maximum metadata protection Linqa can issue **anonymous credentials** (e.g. using BBS+ signatures, keyed-verification anonymous credentials, or simple one-time tokens) that prove “I am allowed to send to this recipient right now” without revealing which identity is speaking. This mode trades some spam resistance for stronger anonymity.

## Envelope Format (conceptual)

```
SealedSenderEnvelope {
    // Visible to the relay
    version: u8,
    recipient_delivery_token: bytes,   // authorizes delivery, reveals nothing about sender
    ciphertext: bytes,                 // AEAD( sender_identity || credential || mls_message , ...)
    
    // Optional server-visible padding / cover
    padding: bytes,
}
```

### Opening on the recipient side

1. Recipient uses their private key (or group secret) to decrypt `ciphertext`.
2. Extracts `sender_identity`, `credential`, and the inner MLS / application message.
3. Verifies the credential against local group state or identity keys.
4. Processes the message normally.

## Delivery Token Design

- Issued by the recipient’s client or by a privacy-preserving service.
- Bound to a specific recipient IdentityId / device set.
- Short-lived (minutes to hours) and single-use or limited-use.
- The relay can verify the token’s validity without learning the sender.
- Tokens can be pre-fetched and rotated to reduce latency.

## Integration with MLS

- Application messages inside an MLS group are carried in sealed-sender envelopes by default.
- Handshake messages (Commit, Welcome, …) may use a slightly different path; some may need to be visible to the Delivery Service for fan-out, but Linqa keeps even handshake metadata minimal.
- The MLS `authenticated_data` or a custom extension can carry a binding to the sealed-sender credential when needed.

## Spam & Abuse Resistance

Because the relay cannot see the sender, classic IP / account-level rate limiting is harder.

Mitigations:

- Delivery tokens are rate-limited per recipient.
- Recipients can issue “deny” tokens or revoke previously issued tokens.
- Optional proof-of-work or anonymous rate-limiting tokens for fully anonymous mode.
- Group admins can still remove misbehaving members via normal MLS Remove (the removal is visible inside the group).

## Privacy Properties Achieved

| Property                        | Status in Linqa sealed-sender |
|---------------------------------|-------------------------------|
| Server cannot see sender        | Yes (default)                 |
| Server cannot link sender across conversations easily | Strongly reduced             |
| Recipient can authenticate sender | Yes                          |
| Forward secrecy of the envelope | Yes (ephemeral keys)          |
| Compatibility with MLS          | First-class                   |

## Residual Risks

- Traffic analysis (timing, size) can still correlate activity. Padding and cover traffic help but do not eliminate the risk.
- A compromised recipient device leaks the sender identity (unavoidable).
- Malicious recipients can try to use delivery tokens to map the social graph; careful token design and rotation limit the damage.

## Implementation Location

```
protocol/sealed-sender/design.md          # this document
core/src/crypto/sealed_sender.rs          # concrete types & seal/open
core/src/crypto/sealed_sender/credential.rs
```

## Future Extensions

- Fully anonymous group messaging (harder; requires different group membership proofs).
- Integration with mixnets or Tor for additional network-level protection.
- Formal verification of the envelope format and credential verification.
