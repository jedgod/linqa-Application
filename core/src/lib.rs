pub mod attachments;
pub mod backup;
pub mod crypto;
pub mod enrollment;
pub mod envelope;
pub mod error;
pub mod ffi;
pub mod groups;
pub mod identity;
pub mod key_package;
pub mod protocol;
pub mod replay;
pub mod safety_number;
pub mod search_tokens;
#[cfg(feature = "uniffi-bindings")]
pub mod uniffi_api;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

#[cfg(feature = "uniffi-bindings")]
uniffi::setup_scaffolding!();

pub use error::{LinqaError, Result};

/// Library version
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
