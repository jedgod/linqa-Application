# MLS Integration for Linqa

This directory will contain:

- Configuration and extensions to MLS (RFC 9420)
- Hybrid post-quantum cipher suites
- Group and channel lifecycle management
- Epoch update policies optimized for large dynamic groups
- Integration notes with sealed-sender and multi-device

Primary library candidates:
- OpenMLS (Rust)
- mls-rs
- Custom extensions as needed

Goal: Efficient, secure groups and channels far beyond the classic ~1,000 member practical limit of sender-keys approaches, while preserving forward secrecy and post-compromise security.
