#!/usr/bin/env python3
"""UJB-02: parses the actual generated UniFFI/JNA Kotlin bindings
(clients/android/app/src/main/java/uniffi/linqa_core/linqa_core.kt) and
checks the `NativeSecureCoreInterface` method surface against
certification/uniffi-jna-binding-allowlist.json. Fails closed (gate FAIL,
non-zero exit) if the generated bindings ever declare a method the
allowlist doesn't know about, or if the interface disappears entirely
(regenerated bindings, wrong path, etc.) rather than silently passing.
"""
import json
import os
import re
import sys
import datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
EVIDENCE_DIR = os.environ.get("LINQA_EVIDENCE_DIR", os.path.join(ROOT, "certification", "evidence"))
os.makedirs(EVIDENCE_DIR, exist_ok=True)

BINDINGS_PATH = os.path.join(
    ROOT, "clients", "android", "app", "src", "main", "java", "uniffi", "linqa_core", "linqa_core.kt"
)
ALLOWLIST_PATH = os.path.join(ROOT, "certification", "uniffi-jna-binding-allowlist.json")


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
    write_gate("UJB2", "FAIL", detail)
    print(f"FAIL: {detail}", file=sys.stderr)
    sys.exit(1)


if not os.path.exists(BINDINGS_PATH):
    fail(f"generated UniFFI bindings not found at {BINDINGS_PATH}")

with open(BINDINGS_PATH, encoding="utf-8") as f:
    src = f.read()

iface_match = re.search(r"public interface NativeSecureCoreInterface\s*\{(.*?)\n\}", src, re.DOTALL)
if not iface_match:
    fail("could not locate `interface NativeSecureCoreInterface` block in generated bindings")

iface_body = iface_match.group(1)
declared_methods = sorted(set(re.findall(r"fun\s+`([a-zA-Z0-9_]+)`", iface_body)))

with open(ALLOWLIST_PATH, encoding="utf-8") as f:
    allowlist = json.load(f)
allowed = sorted(set(allowlist["allowedMethods"]))

unexpected = sorted(set(declared_methods) - set(allowed))
missing = sorted(set(allowed) - set(declared_methods))

if unexpected:
    fail(f"generated bindings declare method(s) outside the UJB-02 allowlist: {unexpected}")
if missing:
    fail(f"UJB-02 allowlist expects method(s) the generated bindings no longer declare: {missing}")

write_gate("UJB2", "PASS", f"binding surface matches allowlist exactly: {declared_methods}")
print(f"PASS: uniffi binding allowlist — {declared_methods}")
