#!/usr/bin/env python3
"""Fails closed if integration-readiness.json drifts from what
currentVaultIntegrationStatus() in safe-default.adapters.ts actually
computes (compared structurally, not by executing TypeScript)."""
import json, os, re, sys, datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EVIDENCE_DIR = os.environ.get("LINQA_EVIDENCE_DIR", os.path.join(ROOT, "certification", "evidence"))
os.makedirs(EVIDENCE_DIR, exist_ok=True)
READINESS = os.path.join(ROOT, "certification", "vault", "integration-readiness.json")
ADAPTERS = os.path.join(ROOT, "server", "src", "integrations", "vault", "safe-default.adapters.ts")


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


with open(READINESS, encoding="utf-8") as f:
    readiness = json.load(f)
with open(ADAPTERS, encoding="utf-8") as f:
    adapters_src = f.read()

# The always-true fields must be literal `true` in currentVaultIntegrationStatus.
always_true_fields = ["encryptedStorage", "hashVerification", "privateVaultSessionLock"]
violations = []
for field in always_true_fields:
    if not readiness.get(field):
        violations.append(f"readiness.json marks `{field}` false, but it is a real, always-on capability")
    if not re.search(rf"{field}:\s*true", adapters_src):
        violations.append(f"safe-default.adapters.ts no longer hardcodes `{field}: true`")

# billingEntitlements is always false in the real function (no billing wiring).
if readiness.get("billingEntitlements") is not False:
    violations.append("readiness.json must mark billingEntitlements false — no billing provider is wired up")
if not re.search(r"billingEntitlements:\s*false", adapters_src):
    violations.append("safe-default.adapters.ts no longer hardcodes billingEntitlements: false")

if violations:
    write_gate("V2", "FAIL", "; ".join(violations))
    print("FAIL:", violations, file=sys.stderr)
    sys.exit(1)

write_gate("V2", "PASS", "vault integration-readiness.json matches safe-default.adapters.ts")
print("PASS: vault readiness validated")
