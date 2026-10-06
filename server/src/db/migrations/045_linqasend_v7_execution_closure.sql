-- LinqaSend v7 audit closure (forward-only; migration 034 is not edited).
--
-- 1. Provider routing must come from the approved contract, so each v7 contract
--    names the registered adapter it authorizes. Nullable: a contract without a
--    key can never authorize a provider call (the execution guard fails closed).
-- 2. A transfer has exactly one responsibility snapshot. 034 only made the
--    snapshot HASH unique, which allowed several snapshots per transfer; with the
--    immutability trigger that made "which snapshot governs?" ambiguous.

ALTER TABLE linqasend_partner_contracts_v7
  ADD COLUMN IF NOT EXISTS provider_adapter_key TEXT;

COMMENT ON COLUMN linqasend_partner_contracts_v7.provider_adapter_key IS
  'Registered provider adapter this contract authorizes for its responsibilities. Execution routes only through this key.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_linqasend_responsibility_snapshot_transfer_v7
  ON linqasend_responsibility_snapshots_v7(transfer_id);
