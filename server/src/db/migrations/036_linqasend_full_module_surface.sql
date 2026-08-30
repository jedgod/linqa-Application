-- Remaining canonical LinqaSend module surface from the full UI/backend pack.
CREATE TABLE IF NOT EXISTS linqasend_external_recipients_v1 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  recipient_kind TEXT NOT NULL CHECK(recipient_kind IN ('EXTERNAL_PERSON','EXTERNAL_BUSINESS')),
  display_name TEXT NOT NULL,
  country_code CHAR(2) NOT NULL,
  currency CHAR(3) NOT NULL,
  phone_hash CHAR(64),
  email_hash CHAR(64),
  verification_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS linqasend_external_recipients_owner_v1 ON linqasend_external_recipients_v1(owner_user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS linqasend_payout_endpoints_v1 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_recipient_id UUID NOT NULL REFERENCES linqasend_external_recipients_v1(id),
  delivery_method TEXT NOT NULL CHECK(delivery_method IN ('BANK','CARD','MOBILE_MONEY','PHONE_CLAIM','EMAIL_CLAIM')),
  provider TEXT NOT NULL,
  provider_token TEXT NOT NULL,
  masked_display TEXT NOT NULL,
  country_code CHAR(2) NOT NULL,
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_token)
);

ALTER TABLE linqasend_recipients ADD COLUMN IF NOT EXISTS external_recipient_id UUID REFERENCES linqasend_external_recipients_v1(id);
CREATE UNIQUE INDEX IF NOT EXISTS linqasend_recipient_external_owner_v1 ON linqasend_recipients(owner_user_id,external_recipient_id) WHERE external_recipient_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS linqasend_money_requests_v1 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id UUID NOT NULL,
  payer_user_id UUID NOT NULL,
  payer_recipient_id UUID NOT NULL REFERENCES linqasend_recipients(id),
  amount_minor BIGINT NOT NULL CHECK(amount_minor > 0),
  currency CHAR(3) NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','AWAITING_PAYMENT','PAID','DECLINED','CANCELED','EXPIRED')),
  paid_transfer_id UUID REFERENCES linqasend_transfers(id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(requester_user_id <> payer_user_id)
);
CREATE INDEX IF NOT EXISTS linqasend_requests_parties_v1 ON linqasend_money_requests_v1(requester_user_id,payer_user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS linqasend_user_settings_v1 (
  user_id UUID PRIMARY KEY,
  default_currency CHAR(3),
  default_payment_method_id UUID REFERENCES linqasend_payment_methods(id),
  transfer_notifications BOOLEAN NOT NULL DEFAULT true,
  request_notifications BOOLEAN NOT NULL DEFAULT true,
  scam_warning_level TEXT NOT NULL DEFAULT 'STANDARD' CHECK(scam_warning_level IN ('STANDARD','ENHANCED')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS linqasend_notification_outbox_v1 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  notification_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS linqasend_notification_pending_v1 ON linqasend_notification_outbox_v1(status,available_at) WHERE status='PENDING';

ALTER TABLE linqasend_payment_methods ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS linqasend_one_default_payment_method_v1 ON linqasend_payment_methods(user_id) WHERE is_default=true AND deleted_at IS NULL;
