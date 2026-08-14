#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CERT="$ROOT/certification"

echo "== No-duplicate-architecture guard =="
python3 "$CERT/no-duplicates/check_no_duplicate_architecture.py"

echo "== CountryLinqa =="
python3 "$CERT/countrylinqa/check_existing_backend.py"
python3 "$CERT/countrylinqa/check_mobile_parity.py"
python3 "$CERT/countrylinqa/validate_readiness.py"

echo "== LinqaSend =="
python3 "$CERT/linqasend/check_existing_fastify.py"
python3 "$CERT/linqasend/validate_provider_readiness.py"

echo "== Vault =="
python3 "$CERT/vault/check_existing_vault.py"
python3 "$CERT/vault/validate_readiness.py"

echo "== Server: typecheck + tests =="
(cd "$ROOT/server" && npx tsc -p tsconfig.json --noEmit && npm test)

echo "== Web: typecheck =="
(cd "$ROOT/clients/web" && npx tsc -b)

echo "== Mobile: typecheck =="
(cd "$ROOT/clients/mobile" && npx tsc --noEmit)

echo
echo "ADDITIVE CLOSURE: ALL GATES GREEN"
