#!/usr/bin/env python3
"""Confirms the real Vault backend/client files still exist."""
import json, os, sys, datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EVIDENCE_DIR = os.environ.get("LINQA_EVIDENCE_DIR", os.path.join(ROOT, "certification", "evidence"))
os.makedirs(EVIDENCE_DIR, exist_ok=True)


def write_gate(gate, status, detail):
    gates_path = os.path.join(EVIDENCE_DIR, "gates.json")
    data = {}
    if os.path.exists(gates_path):
        with open(gates_path, encoding="utf-8") as f:
            data = json.load(f)
    data[gate] = {"status": status, "detail": detail, "recordedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    tmp = gates_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
    os.replace(tmp, gates_path)


required = [
    "server/src/services/file-vault.service.ts",
    "server/src/routes/file-vault.ts",
    "server/src/integrations/vault/contracts.ts",
    "server/src/integrations/vault/safe-default.adapters.ts",
    "clients/web/src/pages/FileVaultPage.tsx",
    "clients/web/src/vault/FileVaultClient.ts",
]
missing = [p for p in required if not os.path.exists(os.path.join(ROOT, p))]
if missing:
    write_gate("V1", "FAIL", f"missing expected vault path(s): {missing}")
    print(f"FAIL: missing {missing}", file=sys.stderr)
    sys.exit(1)

write_gate("V1", "PASS", "real vault backend/client present")
print("PASS: vault exists")
