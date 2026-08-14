# Multi-Device Design for Linqa

## Goals

- Full history and media sync across all linked devices
- No requirement that the “primary” phone stays online
- Strong forward secrecy and post-compromise security even when multiple devices are linked
- Secure device linking that is both user-friendly and cryptographically robust
- Clean unlinking / revocation of a lost or compromised device

## High-Level Model

Linqa treats each physical device as a first-class cryptographic participant.

### Preferred Representation (MLS-centric)
- Every linked device of a user is a separate **leaf** in the MLS ratchet tree of each group the user belongs to.
- A user’s identity has a set of device KeyPackages published in the Key Directory.
- When a new device is linked, it is added to all relevant groups via normal MLS Add + Commit (or a batched multi-group update).
- This gives natural per-device forward secrecy and makes device removal = leaf removal.

### Alternative / Complementary Model (for 1:1 and non-MLS contexts)
- Per-device identity keys + a shared “account” signing key or a device list that is itself protected by a ratchet.
- History is transferred as an encrypted blob under a temporary device-transfer key.

Linqa will primarily use the MLS leaf model for groups and channels, and a clean device-list + transfer protocol for 1:1 and initial history sync.

## Device Linking Flow

### 1. Initiation (Existing Device)
1. User opens “Linked Devices” / “Add Device” on an already-authenticated device.
2. The device generates a short-lived **Device Transfer Key** (or a one-time linking secret) and displays it as a QR code + numeric code.
3. Optionally, the existing device also prepares an encrypted history package.

### 2. New Device
1. New device scans the QR code (or enters the numeric code).
2. The two devices perform a cryptographic handshake (Noise-like or MLS-inspired) authenticated by the short-lived secret.
3. New device generates its own long-term device key pair and KeyPackage.
4. New device sends its KeyPackage and a proof of possession back to the existing device (or directly to the Key Directory via an authenticated channel).

### 3. Registration & Propagation
1. Existing device (or the new device with proper authorization) publishes the new device’s KeyPackage to the Key Directory under the user’s identity.
2. For every group the user belongs to, an MLS Add proposal for the new device leaf is created and committed (can be batched or done lazily on next activity).
3. History transfer: the existing device encrypts a snapshot of relevant conversations under a key derived from the linking handshake and sends it to the new device (directly or via a temporary server blob that is immediately deleted).

### 4. Completion
- New device processes Welcomes / history and is now fully functional.
- User can optionally set a device name (“Pixel 9”, “Work Laptop”, etc.).

## History & Media Sync

- **Initial transfer**: Encrypted snapshot at linking time.
- **Ongoing**: Normal message delivery; each device receives and decrypts messages independently using its own leaf secrets.
- **Media**: Large files are referenced by encrypted content-addressed blobs; devices download on demand.
- **Local storage**: Each device keeps its own encrypted database. There is no unencrypted cloud history.

## Device Removal / Revocation

1. User selects a device to remove on any remaining trusted device.
2. The device’s KeyPackage is marked revoked in the Key Directory.
3. For every group, an MLS Remove proposal is committed, blanking the corresponding leaf.
4. After the epoch advances, the removed device can no longer decrypt new messages.
5. Optional: a “remote wipe” signal can be sent that instructs the removed device to delete local data (best-effort).

Because each device is a separate leaf, compromising one device does not automatically give indefinite access to future messages once it is removed.

## Primary-Phone Independence

- No device is designated as permanently “primary.”
- Any linked device can initiate linking of further devices (subject to user confirmation).
- Any linked device can perform group administration if the user has admin rights.
- Push notifications and delivery work for all devices; the relay does not prefer one device.

## Security Properties

| Property                        | How it is achieved                                      |
|---------------------------------|---------------------------------------------------------|
| Forward Secrecy                 | Per-device leaves + epoch rotation                      |
| Post-Compromise Security        | Removing a compromised device restores security         |
| Authentication of linking       | Short-lived secret + cryptographic handshake            |
| No long-term server-held keys   | All decryption keys stay on devices                     |
| History confidentiality         | History transferred under linking-derived keys only     |

## User Experience Requirements

- Linking should feel as simple as WhatsApp’s or Signal’s current multi-device flows.
- Clear list of linked devices with last-active timestamps.
- Obvious “Remove” / “Log out this device” action.
- Warning when a new device is linked (push notification to all existing devices).
- Recovery path if the user loses all devices (identity recovery via passphrase / social recovery / hardware key — separate design).

## Implementation Sketch (Core)

```
core/sync/
├── device_manager.rs      # Local list of devices, linking state
├── linking.rs             # QR / code handshake, transfer key derivation
├── history_transfer.rs    # Encrypted snapshot creation & import
├── mls_device.rs          # Mapping user devices ↔ MLS leaves
└── revocation.rs          # Key Directory revocation + group Removes
```

## Open Design Points

1. Exact lifetime of the Device Transfer Key (recommended: 5–15 minutes, single use).
2. Whether history transfer is mandatory at linking time or can be deferred.
3. Batching strategy for adding a new device to many groups at once.
4. Handling of offline devices during linking (queue the Add until they come online).
5. Interaction with sealed-sender (device identity vs. user identity in envelopes).

This design gives Linqa a multi-device experience that is both more secure and more flexible than current mainstream messengers while remaining practical for users.
