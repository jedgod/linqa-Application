# G0-G4 Green Label Rules

Green is produced only by an executed check with an evidence reference, an immutable revision, and a production-equivalent or production environment. Environment booleans and file-existence checks are not evidence.

- **G0:** dependency failure injection is truthful; derived capabilities cannot mask degraded dependencies; production boot fails closed.
- **G1:** fresh phone registration, recovery email, signed device enrollment/key package, signed transparency inclusion, and revocation execute end to end.
- **G2:** two fresh clients exchange ciphertext through relay/lease/decrypt/ACK and pass restart, offline, replay, tamper, wrong-recipient, expiry, revocation, plaintext, and duplicate-ACK cases.
- **G3:** a device-farm run uses generated UniFFI code, an actual Android/iOS build, OS-protected custody, encrypted local storage, and a web/native exchange.
- **G4:** operational providers come from the central registry and pass live health checks; clean install and every declared upgrade baseline pass with checksum/lock enforcement.

`GateEvidenceWriter` rejects passed required checks without evidence references. G1-G3 evidence must be signed with the configured Ed25519 test-farm key and bind the exact revision and environment. `GateReleaseController` verifies evidence digests, revision identity, environment, and all five GREEN states before promotion.
