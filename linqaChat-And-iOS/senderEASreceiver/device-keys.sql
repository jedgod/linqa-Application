create table if not exists device_keys (
  user_id uuid primary key,
  identity_key text not null,
  signed_pre_key text not null,
  signature text not null,
  platform text not null check (platform in ('android', 'ios')),
  published_at timestamptz not null default now()
);
