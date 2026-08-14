//! Library entry for the Tauri side of the desktop client.
//!
//! Future surface (examples):
//! - create_identity()
//! - list_conversations()
//! - send_message(...)
//! - link_device(...)
//!
//! All of the above will call into linqa-core and never re-implement crypto.

#[allow(dead_code)]
pub fn version_placeholder() -> &'static str {
    "linqa-desktop scaffolding — core not linked"
}

pub struct FailClosedPlatformKeyProvider;

impl FailClosedPlatformKeyProvider {
    pub fn supports_hardware_backed_keys(&self) -> bool {
        false
    }

    pub fn wrap_key(&self, _alias: &str, _raw_key: &[u8], _context: &[u8]) -> Result<Vec<u8>, &'static str> {
        Err("desktop OS key provider is not configured")
    }

    pub fn unwrap_key(&self, _alias: &str, _wrapped_key: &[u8], _context: &[u8]) -> Result<Vec<u8>, &'static str> {
        Err("desktop OS key provider is not configured")
    }
}
