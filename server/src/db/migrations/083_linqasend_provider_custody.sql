-- Follow-on to 082: never rewrite an installed migration or fabricate opening custody assets.
CREATE TABLE linqasend_provider_custody_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),provider_id TEXT NOT NULL,regulatory_entity_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),provider_account_ref TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider_id,provider_account_ref,currency)
);
CREATE TABLE linqasend_provider_custody_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),account_id UUID NOT NULL REFERENCES linqasend_provider_custody_accounts(id),
  snapshot_id TEXT NOT NULL,balance_minor BIGINT NOT NULL CHECK(balance_minor>=0),as_of TIMESTAMPTZ NOT NULL,
  evidence_sha256 CHAR(64) NOT NULL,observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id,snapshot_id)
);
CREATE INDEX custody_latest_observation ON linqasend_provider_custody_observations(account_id,as_of DESC,observed_at DESC);
CREATE TRIGGER custody_observations_immutable BEFORE UPDATE OR DELETE ON linqasend_provider_custody_observations
  FOR EACH ROW EXECUTE FUNCTION linqasend_wallet_immutable();
CREATE TRIGGER custody_observations_no_truncate BEFORE TRUNCATE ON linqasend_provider_custody_observations
  FOR EACH STATEMENT EXECUTE FUNCTION linqasend_wallet_immutable();
CREATE TABLE linqasend_provider_custody_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),regulatory_entity_id TEXT NOT NULL,currency CHAR(3) NOT NULL,
  liability_minor NUMERIC(30,0) NOT NULL,asset_minor NUMERIC(30,0) NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('COVERED','SHORTFALL','UNVERIFIED')),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER custody_checks_immutable BEFORE UPDATE OR DELETE ON linqasend_provider_custody_checks
  FOR EACH ROW EXECUTE FUNCTION linqasend_wallet_immutable();
-- Each wallet/entity is reconciled against the combined assets for that entity, never against every provider independently.
CREATE VIEW linqasend_wallet_liabilities_by_entity_v9 AS
  SELECT w.regulatory_entity_id,p.currency,sum(p.amount_minor) AS liability_minor
  FROM linqasend_wallet_postings p JOIN linqasend_wallet_accounts_v2 w ON w.id=p.wallet_id
  GROUP BY w.regulatory_entity_id,p.currency;
