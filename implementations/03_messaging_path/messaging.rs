//! Minimal end-to-end messaging path for Linqa
//!
//! Demonstrates:
//!   sender → seal (hybrid + sealed-sender) → “server” relay → recipient open
//!
//! This is intentionally a clean, in-process reference implementation that
//! exercises the real crypto from modules 01 and 02. A production server
//! would replace the in-memory Relay with HTTP / WebSocket + the Key Directory.

use crate::hybrid_kem::{
    HybridKem, HybridPublicKey, HybridSecretKey, PqcStrength, SimulatedPqKem,
};
use crate::sealed_sender::{
    make_delivery_token, open, seal, DeliveryToken, SealedSenderCredential, SealedSenderEnvelope,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// A message that a client wants to send.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutgoingMessage {
    pub conversation_id: String,
    pub body: String,
    pub timestamp: u64,
}

/// What the recipient ultimately recovers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveredMessage {
    pub sender_identity: String,
    pub conversation_id: String,
    pub body: String,
    pub timestamp: u64,
}

/// Simple in-memory relay that only sees sealed envelopes + delivery tokens.
pub struct Relay {
    /// recipient_hint → queue of envelopes
    queues: Mutex<HashMap<Vec<u8>, Vec<SealedSenderEnvelope>>>,
}

impl Relay {
    pub fn new() -> Self {
        Self {
            queues: Mutex::new(HashMap::new()),
        }
    }

    pub fn submit(&self, envelope: SealedSenderEnvelope) {
        let hint = envelope.delivery_token.recipient_hint.clone();
        let mut q = self.queues.lock().unwrap();
        q.entry(hint).or_default().push(envelope);
    }

    pub fn fetch(&self, recipient_hint: &[u8]) -> Vec<SealedSenderEnvelope> {
        let mut q = self.queues.lock().unwrap();
        q.remove(recipient_hint).unwrap_or_default()
    }
}

impl Default for Relay {
    fn default() -> Self {
        Self::new()
    }
}

/// A minimal Linqa client that can send and receive using the hybrid crypto.
pub struct MessagingClient {
    pub identity: String,
    pub device_id: String,
    pub kp: (HybridPublicKey, HybridSecretKey),
    pub store: Arc<Mutex<crate::encrypted_store::EncryptedLocalStore>>,
}

impl MessagingClient {
    pub fn new(identity: &str, device_id: &str, passphrase: &str) -> Self {
        let kp = HybridKem::<SimulatedPqKem>::generate_keypair(PqcStrength::Standard);
        let mut store = crate::encrypted_store::EncryptedLocalStore::in_memory();
        store.unlock_with_passphrase(passphrase).expect("unlock");
        Self {
            identity: identity.to_string(),
            device_id: device_id.to_string(),
            kp,
            store: Arc::new(Mutex::new(store)),
        }
    }

    pub fn public_key(&self) -> &HybridPublicKey {
        &self.kp.0
    }

    /// Send an E2EE message via the relay.
    pub fn send(
        &self,
        relay: &Relay,
        recipient_pk: &HybridPublicKey,
        recipient_hint: &[u8],
        msg: &OutgoingMessage,
    ) -> Result<(), String> {
        let payload = serde_json::to_vec(msg).map_err(|e| e.to_string())?;

        let credential = SealedSenderCredential::Direct {
            identity: self.identity.clone(),
            device: self.device_id.clone(),
            recipient: hex::encode(recipient_hint),
            nonce: {
                let mut n = [0u8; 32];
                use rand::RngCore;
                rand::rngs::OsRng.fill_bytes(&mut n);
                n
            },
            signature: vec![], // production: sign with identity key
        };

        let token = make_delivery_token(recipient_hint, 3600);
        let envelope = seal(
            &self.identity,
            &credential,
            &payload,
            recipient_pk,
            token,
        )?;

        relay.submit(envelope);
        Ok(())
    }

    /// Receive and decrypt all pending messages for this client.
    pub fn receive(&self, relay: &Relay, my_hint: &[u8]) -> Result<Vec<DeliveredMessage>, String> {
        let envelopes = relay.fetch(my_hint);
        let mut out = Vec::new();

        for env in envelopes {
            let (sender, _cred, payload) = open(&env, &self.kp.1)?;
            let msg: OutgoingMessage =
                serde_json::from_slice(&payload).map_err(|e| e.to_string())?;
            out.push(DeliveredMessage {
                sender_identity: sender,
                conversation_id: msg.conversation_id,
                body: msg.body,
                timestamp: msg.timestamp,
            });
        }
        Ok(out)
    }
}

/// Convenience demo that runs a full send → relay → receive cycle.
pub fn demo_roundtrip() -> Result<(), String> {
    let relay = Relay::new();

    let alice = MessagingClient::new("alice", "alice-phone", "alice-pass");
    let bob = MessagingClient::new("bob", "bob-phone", "bob-pass");

    let bob_hint = b"bob-hint-001";
    let alice_hint = b"alice-hint-001";

    let msg = OutgoingMessage {
        conversation_id: "conv-1".into(),
        body: "Hello Bob — this is a real hybrid-sealed message.".into(),
        timestamp: 1_725_000_000,
    };

    alice.send(&relay, bob.public_key(), bob_hint, &msg)?;

    let received = bob.receive(&relay, bob_hint)?;
    assert_eq!(received.len(), 1);
    assert_eq!(received[0].sender_identity, "alice");
    assert_eq!(received[0].body, msg.body);

    println!("✓ Round-trip succeeded");
    println!("  From : {}", received[0].sender_identity);
    println!("  Body : {}", received[0].body);
    Ok(())
}
