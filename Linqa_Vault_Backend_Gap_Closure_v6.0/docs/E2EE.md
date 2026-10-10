# E2EE resolution

There are two different paths and they must not be conflated.

**A. External/social/message/client intake**: the user explicitly asks Linqa to import a source object. A transient quarantine service may see plaintext solely to perform validation/malware/DLP before Vault encryption. Quarantine is isolated, TTL-limited, non-browsable, audited and deleted after completion/block/timeout. After a clean verdict, the client receives an authenticated transient copy, encrypts it with the Vault key, uploads ciphertext, and finalizes the object. The Vault service never stores the plaintext as a Vault object.

**B. Device-originated Vault upload**: client scans first, encrypts first, uploads ciphertext. The server cannot honestly advertise server malware inspection for this ciphertext. It may verify transport integrity, size, quota and encrypted metadata schema only.

Never add a server-held master Vault decryption key to make scanning convenient.
