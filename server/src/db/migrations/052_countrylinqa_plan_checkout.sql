-- CountryLinqa plans and the checkout attempts behind "Compare Plans > Payment Method > Confirm > Result".
--
-- Prices live here, on the server. The app never sends a price, and a plan only becomes active when the
-- billing webhook (EntitlementService.applyWebhook) updates subscription_accounts; a checkout row only
-- records that someone tried to pay.
CREATE TABLE IF NOT EXISTS countrylinqa_plan_catalog (
  plan_code TEXT PRIMARY KEY CHECK (plan_code IN ('PREMIUM','ELITE')),
  tier_rank INTEGER NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  monthly_price_minor INTEGER NOT NULL CHECK (monthly_price_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Prices from the approved plan mockups ($4.99 and $9.99 a month).
INSERT INTO countrylinqa_plan_catalog (plan_code, tier_rank, display_name, monthly_price_minor) VALUES
  ('PREMIUM', 1, 'Premium', 499),
  ('ELITE', 2, 'Elite', 999)
ON CONFLICT (plan_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS countrylinqa_checkouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES countrylinqa_plan_catalog(plan_code),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CARD','APPLE_PAY','GOOGLE_PAY','PAYPAL')),
  amount_minor INTEGER NOT NULL,
  currency CHAR(3) NOT NULL,
  provider TEXT NOT NULL,
  provider_session_ref TEXT UNIQUE,
  checkout_url TEXT,
  state TEXT NOT NULL DEFAULT 'CREATED' CHECK (state IN ('CREATED','CANCELED','FAILED')),
  failure_code TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_countrylinqa_checkouts_user ON countrylinqa_checkouts(user_id, created_at DESC);
