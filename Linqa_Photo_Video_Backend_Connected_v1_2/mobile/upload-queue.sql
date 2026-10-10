PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS chat_media_uploads_v1 (
 upload_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL, device_id TEXT NOT NULL, chat_id TEXT NOT NULL,
 message_id TEXT NOT NULL, encrypted_uri TEXT NOT NULL,
 local_sealed_descriptor TEXT NOT NULL,
 digest TEXT NOT NULL, byte_length INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('QUEUED','UPLOADED','MESSAGE_QUEUED','FAILED')),
 UNIQUE(account_id,device_id,chat_id,message_id)
);
CREATE INDEX IF NOT EXISTS chat_media_queue_scope ON chat_media_uploads_v1(account_id,device_id,chat_id,status);
