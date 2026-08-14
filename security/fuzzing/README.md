# Fuzzing Targets

Fuzz parsers for message envelopes, key packages, backups, attachment manifests,
group state, FFI DTOs, and signaling payloads. Every target must reject malformed
input without panic, unbounded allocation, partial success, or sensitive output.

Corpus seeds should include the versioned fixtures under `tests/protocol-fixtures`.
Fuzzing is a release gate; this directory documents targets but does not count as
evidence that a sustained fuzzing campaign has passed.
