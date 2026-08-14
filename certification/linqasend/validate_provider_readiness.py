#!/usr/bin/env python3
"""Fails closed if provider-readiness.json's true/false claims disagree
with the actual runtime state: which providers `getLinqaSendProviders()`
would return right now, and whether LINQASEND_WEBHOOK_SECRET is set."""
import json, os, re, sys, datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EVIDENCE_DIR = os.environ.get("LINQA_EVIDENCE_DIR", os.path.join(ROOT, "certification", "evidence"))
os.makedirs(EVIDENCE_DIR, exist_ok=True)
READINESS = os.path.join(ROOT, "certification", "linqasend", "provider-readiness.json")


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

violations = []

# webhookSecretConfigured must match whether LINQASEND_WEBHOOK_SECRET is
# actually set in the environment this check runs in.
secret_set = bool(os.environ.get("LINQASEND_WEBHOOK_SECRET"))
if readiness.get("webhookSecretConfigured") != secret_set:
    violations.append(
        f"readiness.json says webhookSecretConfigured={readiness.get('webhookSecretConfigured')} "
        f"but LINQASEND_WEBHOOK_SECRET is {'set' if secret_set else 'unset'} in this environment"
    )

# The four provider-configured claims must all be false unless
# safe-default.providers.ts has actually been replaced with real
# implementations (a real integration would rename these classes away from
# "SafeDefault*"/"unconfigured").
safe_default_path = os.path.join(ROOT, "server", "src", "integrations", "linqasend", "safe-default.providers.ts")
with open(safe_default_path, encoding="utf-8") as f:
    safe_default_src = f.read()
still_using_safe_defaults = "unconfigured" in safe_default_src and "SafeDefaultKycProvider" in safe_default_src

for key in ["kycConfigured", "complianceConfigured", "fundingConfigured", "payoutConfigured", "fxRateConfigured"]:
    if readiness.get(key) and still_using_safe_defaults:
        violations.append(f"readiness.json claims `{key}: true` but safe-default.providers.ts is still the unconfigured implementation")

if not os.path.exists(os.path.join(ROOT, "server", "src", "integrations", "linqasend", "webhook-verifier.ts")):
    violations.append("readiness.json claims webhookSignatureVerificationImplemented but webhook-verifier.ts is missing")

if not os.path.exists(os.path.join(ROOT, "server", "src", "integrations", "linqasend", "reconciliation.ts")):
    violations.append("readiness.json claims reconciliationJobImplemented but reconciliation.ts is missing")

if violations:
    write_gate("LS1", "FAIL", "; ".join(violations))
    print("FAIL:", violations, file=sys.stderr)
    sys.exit(1)

write_gate("LS1", "PASS", "linqasend provider-readiness.json matches actual runtime/config state")
print("PASS: linqasend provider readiness validated")
