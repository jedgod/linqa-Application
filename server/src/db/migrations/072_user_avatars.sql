CREATE TABLE IF NOT EXISTS user_avatars (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  image BYTEA NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 5242880),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
