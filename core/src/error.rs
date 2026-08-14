use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum LinqaError {
    #[error("invalid input: {0}")]
    InvalidInput(&'static str),
    #[error("validation failed: {0}")]
    ValidationFailed(&'static str),
    #[error("authentication failed")]
    AuthenticationFailed,
    #[error("expired")]
    Expired,
    #[error("replay detected")]
    ReplayDetected,
    #[error("cryptographic operation failed")]
    CryptoFailure,
    #[error("serialization failed")]
    SerializationFailure,
    #[error("invalid state: {0}")]
    InvalidState(&'static str),
    #[error("storage operation failed: {0}")]
    StorageFailure(&'static str),
}

pub type Result<T> = std::result::Result<T, LinqaError>;
