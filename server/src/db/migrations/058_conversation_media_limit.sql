-- Supports short recordings while bounding each encrypted object and per-user storage in the service.
ALTER TABLE conversation_media DROP CONSTRAINT IF EXISTS conversation_media_envelope_check;
ALTER TABLE conversation_media ADD CONSTRAINT conversation_media_envelope_check CHECK (octet_length(envelope) BETWEEN 32 AND 33554432);
