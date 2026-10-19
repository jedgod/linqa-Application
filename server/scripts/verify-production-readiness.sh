#!/usr/bin/env bash
# Read-only configuration/contract audit. No secret values are printed.
set -Eeuo pipefail
trap 'printf "%s\n" "AUDIT FAILED: Configuration or readiness checks did not pass." >&2' ERR

for target_var in DATABASE_URL LINQASEND_PROVIDER_URL LINQASEND_PROVIDER_TOKEN LINQASEND_TOKEN_KMS_KEY_ID LINQASEND_TOKEN_KMS_REGION LINQASEND_CUSTODY_MANIFEST_PATH; do
  if [[ -z "${!target_var:-}" ]]; then
    printf 'MISSING_CONFIGURATION: %s\n' "$target_var" >&2
    exit 1
  fi
done
if [[ ! -f "$LINQASEND_CUSTODY_MANIFEST_PATH" || ! -r "$LINQASEND_CUSTODY_MANIFEST_PATH" ]]; then
  printf '%s\n' 'CUSTODY_MANIFEST_NOT_READABLE' >&2
  exit 1
fi

node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
try {
  const manifest = JSON.parse(readFileSync(process.env.LINQASEND_CUSTODY_MANIFEST_PATH, 'utf8'));
  if (!manifest || Object.keys(manifest).length !== 1 || !Array.isArray(manifest.accounts) || !manifest.accounts.length) throw new Error();
  const fields = ['providerId', 'regulatoryEntityId', 'currency', 'accountReference'];
  const seen = new Set();
  for (const account of manifest.accounts) {
    if (!account || Object.keys(account).length !== fields.length || !fields.every(k => typeof account[k] === 'string' && account[k].trim())) throw new Error();
    if (!/^[A-Z]{3}$/.test(account.currency)) throw new Error();
    const identity = JSON.stringify([account.providerId, account.accountReference, account.currency]);
    if (seen.has(identity)) throw new Error();
    seen.add(identity);
  }
  console.log('CUSTODY_MANIFEST_STRUCTURE_VALID');
} catch {
  console.error('CUSTODY_MANIFEST_INVALID');
  process.exit(1);
}
NODE

server_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$server_dir"
if [[ -f dist/jobs/wallet-provider-preflight.js ]]; then
  node dist/jobs/wallet-provider-preflight.js
elif [[ -f src/jobs/wallet-provider-preflight.ts && -f node_modules/tsx/dist/loader.mjs ]]; then
  node --import ./node_modules/tsx/dist/loader.mjs src/jobs/wallet-provider-preflight.ts
else
  printf '%s\n' 'WALLET_PREFLIGHT_ENTRYPOINT_MISSING' >&2
  exit 1
fi
printf '%s\n' 'CONFIGURATION_AND_WALLET_PREFLIGHT_PASSED' \
  'This audit does not certify live KMS access, cluster replication, load capacity, or production release approval.'
