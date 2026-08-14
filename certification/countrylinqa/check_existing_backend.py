#!/usr/bin/env python3
"""Confirms the real CountryLinqa backend (server/src/services/countrylinqa)
still exists with its real subdirectories, rather than having been
regressed or replaced by a pack's from-scratch reimplementation."""
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
    "server/src/services/countrylinqa/service.ts",
    "server/src/services/countrylinqa/entitlements.ts",
    "server/src/services/countrylinqa/risk.ts",
    "server/src/services/countrylinqa/golive",
    "server/src/services/countrylinqa/final",
    "server/src/services/countrylinqa/security",
    "server/src/routes/countrylinqa",
]
missing = [p for p in required if not os.path.exists(os.path.join(ROOT, p))]

if missing:
    write_gate("CL1", "FAIL", f"missing expected CountryLinqa backend path(s): {missing}")
    print(f"FAIL: missing {missing}", file=sys.stderr)
    sys.exit(1)

write_gate("CL1", "PASS", "real CountryLinqa backend present")
print("PASS: countrylinqa backend exists")
