//! Linqa priority-gap implementations
//!
//! This crate is a staging area for the six highest-priority missing pieces.
//! Once reviewed they can be moved into the main `linqa-core` crate.

pub mod hybrid_crypto {
    include!("01_hybrid_crypto/hybrid_kem.rs");
    include!("01_hybrid_crypto/sealed_sender.rs");
}

pub mod encrypted_store {
    include!("02_encrypted_store/encrypted_store.rs");
}

// The remaining modules reference the above; they are kept as standalone
// source files for clarity and stepwise review.
