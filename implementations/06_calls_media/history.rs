//! Population helpers for the previously “hollow” Calls and Media features
//!
//! These modules turn empty `call_history` / `media_index` tables into
//! something that can be written by a real call or attachment flow.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallRecord {
    pub id: String,
    pub conversation_id: String,
    pub direction: CallDirection,
    pub participants: Vec<String>,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    pub duration_secs: Option<u64>,
    pub call_type: CallType,
    pub status: CallStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CallDirection {
    Incoming,
    Outgoing,
    Missed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CallType {
    Audio,
    Video,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CallStatus {
    Completed,
    Missed,
    Rejected,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaRecord {
    pub id: String,
    pub conversation_id: String,
    pub sender_id: String,
    pub media_type: MediaType,
    pub mime: String,
    pub size: u64,
    pub filename: Option<String>,
    pub created_at: u64,
    /// Content-addressed reference (hash of ciphertext)
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MediaType {
    Image,
    Video,
    Audio,
    VoiceNote,
    Document,
    Other,
}

/// Simple in-memory indexes that a real server would back with PostgreSQL.
pub struct CallHistory {
    records: Mutex<HashMap<String, CallRecord>>,
}

impl CallHistory {
    pub fn new() -> Self {
        Self {
            records: Mutex::new(HashMap::new()),
        }
    }

    pub fn record_completed_call(&self, mut record: CallRecord) {
        if let (Some(end), start) = (record.ended_at, record.started_at) {
            record.duration_secs = Some(end.saturating_sub(start));
        }
        record.status = CallStatus::Completed;
        let mut map = self.records.lock().unwrap();
        map.insert(record.id.clone(), record);
    }

    pub fn record_missed(&self, mut record: CallRecord) {
        record.status = CallStatus::Missed;
        record.ended_at = Some(now());
        let mut map = self.records.lock().unwrap();
        map.insert(record.id.clone(), record);
    }

    pub fn list_for_conversation(&self, conversation_id: &str) -> Vec<CallRecord> {
        let map = self.records.lock().unwrap();
        let mut v: Vec<_> = map
            .values()
            .filter(|r| r.conversation_id == conversation_id)
            .cloned()
            .collect();
        v.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        v
    }

    pub fn list_all(&self) -> Vec<CallRecord> {
        let map = self.records.lock().unwrap();
        let mut v: Vec<_> = map.values().cloned().collect();
        v.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        v
    }
}

impl Default for CallHistory {
    fn default() -> Self {
        Self::new()
    }
}

pub struct MediaIndex {
    records: Mutex<HashMap<String, MediaRecord>>,
}

impl MediaIndex {
    pub fn new() -> Self {
        Self {
            records: Mutex::new(HashMap::new()),
        }
    }

    /// Called when an attachment / voice note / video is successfully sent.
    pub fn index_sent_media(&self, record: MediaRecord) {
        let mut map = self.records.lock().unwrap();
        map.insert(record.id.clone(), record);
    }

    pub fn list_for_conversation(&self, conversation_id: &str) -> Vec<MediaRecord> {
        let map = self.records.lock().unwrap();
        let mut v: Vec<_> = map
            .values()
            .filter(|r| r.conversation_id == conversation_id)
            .cloned()
            .collect();
        v.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        v
    }

    pub fn list_by_type(&self, media_type: MediaType) -> Vec<MediaRecord> {
        let map = self.records.lock().unwrap();
        map.values()
            .filter(|r| std::mem::discriminant(&r.media_type) == std::mem::discriminant(&media_type))
            .cloned()
            .collect()
    }
}

impl Default for MediaIndex {
    fn default() -> Self {
        Self::new()
    }
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Helper that a call-signaling layer would call when a call ends successfully.
pub fn on_call_ended(
    history: &CallHistory,
    id: &str,
    conversation_id: &str,
    direction: CallDirection,
    participants: Vec<String>,
    started_at: u64,
    call_type: CallType,
) {
    let record = CallRecord {
        id: id.to_string(),
        conversation_id: conversation_id.to_string(),
        direction,
        participants,
        started_at,
        ended_at: Some(now()),
        duration_secs: None,
        call_type,
        status: CallStatus::Completed,
    };
    history.record_completed_call(record);
}

/// Helper that an attachment sender would call after the encrypted blob is stored.
pub fn on_media_sent(
    index: &MediaIndex,
    id: &str,
    conversation_id: &str,
    sender_id: &str,
    media_type: MediaType,
    mime: &str,
    size: u64,
    filename: Option<String>,
    content_hash: &str,
) {
    let record = MediaRecord {
        id: id.to_string(),
        conversation_id: conversation_id.to_string(),
        sender_id: sender_id.to_string(),
        media_type,
        mime: mime.to_string(),
        size,
        filename,
        created_at: now(),
        content_hash: content_hash.to_string(),
    };
    index.index_sent_media(record);
}
