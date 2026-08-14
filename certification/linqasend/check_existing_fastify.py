#!/usr/bin/env python3
"""Confirms the real Fastify LinqaSend implementation
(server/src/services/linqasend/*, server/src/routes/linqasend/routes.ts)
still exists and remains the sole implementation, rather than having been
regressed or duplicated by a second backend (e.g. a NestJS `apps/api`
module, matching the exact mistake this whole pack warns against)."""
import glob, json, os, sys, datetime

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


def fail(detail: str) -> None:
    write_gate("LS0", "FAIL", detail)
    print(f"FAIL: {detail}", file=sys.stderr)
    sys.exit(1)


pkg_path = os.path.join(ROOT, "server", "package.json")
if not os.path.exists(pkg_path):
    fail("server/package.json missing")
with open(pkg_path, encoding="utf-8") as f:
    if '"fastify"' not in f.read():
        fail("authoritative Fastify server not detected in server/package.json")

for forbidden in ["apps/linqasend-api", "services/linqasend", "apps/api/src/modules/linqasend"]:
    if os.path.exists(os.path.join(ROOT, forbidden)):
        fail(f"duplicate LinqaSend root exists: {forbidden}")

required = [
    "server/src/services/linqasend/quote.service.ts",
    "server/src/services/linqasend/transfer-orchestrator.service.ts",
    "server/src/services/linqasend/ledger.service.ts",
    "server/src/routes/linqasend/routes.ts",
    "server/src/integrations/linqasend/provider.contracts.ts",
    "server/src/integrations/linqasend/provider.registry.ts"
]
missing = [p for p in required if not os.path.exists(os.path.join(ROOT, p))]
if missing:
    fail(f"missing expected LinqaSend backend path(s): {missing}")

source = ""
for p in glob.glob(os.path.join(ROOT, "server", "src", "**", "*.ts"), recursive=True):
    with open(p, encoding="utf-8", errors="ignore") as f:
        source += f.read().lower()
for concept in ["quote", "transfer", "ledger"]:
    if concept not in source:
        fail(f"existing LinqaSend concept missing from server/src: {concept}")

write_gate("LS0", "PASS", "existing Fastify LinqaSend implementation remains authoritative, no duplicate backend")
print("PASS: existing Fastify LinqaSend implementation remains authoritative")
