-- Run in the existing account-isolated mobile/desktop SQLite store.
CREATE TABLE IF NOT EXISTS linqa_secure_outbox_v2 (
 key TEXT PRIMARY KEY NOT NULL,
 value TEXT NOT NULL
);
-- AtomicStore mappings (parameterized values only):
-- insertIfAbsent: INSERT OR IGNORE INTO linqa_secure_outbox_v2(key,value) VALUES(?,?);
-- scanPrefix: SELECT key,value FROM linqa_secure_outbox_v2 WHERE key>=? ORDER BY key;
-- Filter returned keys using startsWith(prefix); do not use interpolated LIKE.
-- delete: DELETE FROM linqa_secure_outbox_v2 WHERE key=?;
-- Resolve write promises only after committing the host SQLite transaction.
