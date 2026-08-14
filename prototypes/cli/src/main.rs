//! Linqa CLI prototype
//!
//! Exercises the core library's real cryptography (identity, key packages,
//! device enrollment, message envelopes) so we can verify the public API is
//! usable end-to-end from a plain Rust binary.

use clap::{Parser, Subcommand};
use linqa_core::{
    enrollment::{create_proof, verify_proof, EnrollmentChallenge},
    envelope::{decrypt, encrypt},
    identity::DeviceSecrets,
    key_package::{create_key_package, validate_key_package},
    replay::ReplayCache,
    VERSION,
};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Parser)]
#[command(name = "linqa")]
#[command(about = "Linqa secure messenger — core prototype CLI", version = VERSION)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Show library version
    Info,

    /// Generate a device identity and print its public keys
    Identity,

    /// Create and validate a signed key package for a device
    KeyPackage {
        #[arg(long, default_value = "alice")]
        user_id: String,
        #[arg(long, default_value = "alice-phone")]
        device_id: String,
    },

    /// Run a device-enrollment challenge/proof/verify round trip
    Enroll {
        #[arg(long, default_value = "alice")]
        user_id: String,
        #[arg(long, default_value = "Alice's phone")]
        device_name: String,
        #[arg(long, default_value = "ANDROID")]
        platform: String,
    },

    /// Encrypt a message from one freshly generated device to another, then decrypt it
    Envelope {
        #[arg(long, default_value = "hello from the CLI")]
        message: String,
    },
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before the Unix epoch")
        .as_secs() as i64
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Info => {
            println!("linqa-core version : {}", VERSION);
        }

        Commands::Identity => {
            let device = DeviceSecrets::generate();
            let public = device.public_identity();
            println!("signing public key    : {}", hex::encode(public.signing_public_key));
            println!("encryption public key : {}", hex::encode(public.encryption_public_key));
        }

        Commands::KeyPackage { user_id, device_id } => {
            let device = DeviceSecrets::generate();
            let created = now_unix();
            let expires = created + 30 * 24 * 60 * 60;

            let package = create_key_package(&device, &user_id, &device_id, created, expires)?;
            println!("{}", serde_json::to_string_pretty(&package)?);
            println!("package hash: {}", hex::encode(package.package_hash()));

            validate_key_package(&package, created + 1)?;
            println!("validation  : OK");
        }

        Commands::Enroll { user_id, device_name, platform } => {
            let device = DeviceSecrets::generate();
            let challenge = EnrollmentChallenge {
                challenge_id: "018f6bf4-44d5-7e15-a6fa-030f0f6fe000".to_owned(),
                user_id: user_id.clone(),
                nonce: [7u8; 32],
                expires_at_unix: now_unix() + 300,
            };

            let proof = create_proof(&challenge, &device, &device_name, &platform)?;
            println!("{}", serde_json::to_string_pretty(&proof)?);

            verify_proof(&challenge, &proof, now_unix())?;
            println!("verification: OK");
        }

        Commands::Envelope { message } => {
            let alice = DeviceSecrets::generate();
            let bob = DeviceSecrets::generate();
            let created = now_unix();
            let expires = created + 600;

            let envelope = encrypt(
                &alice,
                bob.public_identity().encryption_public_key,
                "alice",
                "alice-phone",
                "bob",
                "bob-phone",
                "018f6bf4-44d5-7e15-a6fa-030f0f6fe001",
                message.as_bytes(),
                created,
                expires,
            )?;
            println!("ciphertext bytes: {}", envelope.ciphertext.len());

            let mut replay = ReplayCache::new(100)?;
            let plaintext = decrypt(
                &bob,
                "bob-phone",
                alice.public_identity().signing_public_key,
                &envelope,
                created + 1,
                &mut replay,
            )?;
            println!("decrypted       : {}", String::from_utf8_lossy(&plaintext));
        }
    }

    Ok(())
}
