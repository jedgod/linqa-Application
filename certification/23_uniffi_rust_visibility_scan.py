#!/usr/bin/env python3
"""UJB-04: `core/src/identity.rs`'s `DeviceSecrets` struct (the in-memory
holder of the Ed25519/X25519/ML-KEM private key bytes) must keep its three
fields non-`pub` — only `DeviceKeyMaterial` (the explicit, deliberate
export/import DTO used by `export_key_material`/`from_key_material`) is
allowed to expose them. This catches an accidental `pub` added to
`DeviceSecrets` directly, which would let any Rust caller in the crate read
private key bytes without going through the one sanctioned export path.
"""
import os
import re
import sys
import json
import datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
EVIDENCE_DIR = os.environ.get("LINQA_EVIDENCE_DIR", os.path.join(ROOT, "certification", "evidence"))
os.makedirs(EVIDENCE_DIR, exist_ok=True)
IDENTITY_RS = os.path.join(ROOT, "core", "src", "identity.rs")


def write_gate(gate, status, detail):
    gates_path = os.path.join(EVIDENCE_DIR, "gates.json")
    data = {}
    if os.path.exists(gates_path):
        with open(gates_path, encoding="utf-8") as f:
            data = json.load(f)
    data[gate] = {
        "status": status,
        "detail": detail,
        "recordedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    tmp = gates_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
    os.replace(tmp, gates_path)


def fail(detail: str) -> None:
    write_gate("UJB4", "FAIL", detail)
    print(f"FAIL: {detail}", file=sys.stderr)
    sys.exit(1)


if not os.path.exists(IDENTITY_RS):
    fail(f"expected file not found: {IDENTITY_RS}")

with open(IDENTITY_RS, encoding="utf-8") as f:
    src = f.read()

struct_match = re.search(r"pub struct DeviceSecrets\s*\{(.*?)\n\}", src, re.DOTALL)
if not struct_match:
    fail("could not locate `pub struct DeviceSecrets { ... }` in identity.rs")

body = struct_match.group(1)
pub_fields = re.findall(r"^\s*pub\s+\w+\s*:", body, re.MULTILINE)
if pub_fields:
    fail(f"DeviceSecrets exposes {len(pub_fields)} `pub` field(s) — private key bytes must only leave via export_key_material()")

write_gate("UJB4", "PASS", "DeviceSecrets keeps all fields non-pub; only DeviceKeyMaterial is the deliberate export DTO")
print("PASS: rust visibility scan")
