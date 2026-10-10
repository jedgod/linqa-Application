-- Linqa attachment source of truth. Apply on PostgreSQL.

create extension if not exists pgcrypto;

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  sender_id uuid not null,
  kind text not null check (kind in (
    'text','photo','video','voice','document','design','ai_image','location','poll','event','meeting'
  )),
  body text,
  client_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  kind text not null,
  mime text not null,
  byte_size integer not null check (byte_size >= 0),
  storage_key text not null,
  width integer,
  height integer,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create table if not exists locations (
  message_id uuid primary key references messages(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  label text
);

create table if not exists polls (
  message_id uuid primary key references messages(id) on delete cascade,
  question text not null,
  multiple boolean not null default false,
  closes_at timestamptz
);

create table if not exists poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls(message_id) on delete cascade,
  label text not null,
  position integer not null
);

create table if not exists poll_votes (
  poll_id uuid not null references polls(message_id) on delete cascade,
  option_id uuid not null references poll_options(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, option_id, user_id)
);

create table if not exists events (
  message_id uuid primary key references messages(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  place text,
  latitude double precision,
  longitude double precision
);

create table if not exists meetings (
  message_id uuid primary key references messages(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  join_path text not null
);

create index if not exists messages_conversation_idx on messages (conversation_id, created_at);
