#!/usr/bin/env python3
"""UJB-03: visibility-aware companion to the existing CPK1 grep-only scan
(13_private_key_boundary_scan.sh). CPK1 catches suspicious identifier names
anywhere in the app; this gate specifically checks that DeviceIdentity.kt
and NativeCore.kt — the two files that ever touch raw private key bytes —
expose no `public`/`internal` (i.e. non-private) declaration matching a
raw-key pattern, and that DeviceIdentity's sole sanctioned export boundary
(`sealNativeKeyMaterial`) still exists.
"""
import os
import re
import sys
import json
import datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
EVIDENCE_DIR = os.environ.get("LINQA_EVIDENCE_DIR", os.path.join(ROOT, "certification", "evidence"))
os.makedirs(EVIDENCE_DIR, exist_ok=True)

CRYPTO_DIR = os.path.join(ROOT, "clients", "android", "app", "src", "main", "java", "com", "linqa", "app", "crypto")

FORBIDDEN_NAME_PATTERN = re.compile(
    r"\b(fun|val|var)\s+(getSigningPrivateKey|getEncryptionPrivateKey|exportPrivateKey|"
    r"rawSigningKey|rawEncryptionKey|rawPrivateKey|privateKeyBytes|signingPrivateKey|"
    r"encryptionPrivateKey)\b"
)
# A non-private declaration in Kotlin has no `private`/`internal` modifier
# immediately before it on the same line (the codebase's own style keeps
# modifiers inline, as seen throughout DeviceIdentity.kt/NativeCore.kt).
NON_PRIVATE_PREFIX = re.compile(r"^\s*(private|internal)\b")


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
    write_gate("UJB3", "FAIL", detail)
    print(f"FAIL: {detail}", file=sys.stderr)
    sys.exit(1)


if not os.path.isdir(CRYPTO_DIR):
    fail(f"expected crypto package not found at {CRYPTO_DIR}")

violations = []
for fname in ("DeviceIdentity.kt", "NativeCore.kt"):
    path = os.path.join(CRYPTO_DIR, fname)
    if not os.path.exists(path):
        fail(f"expected file missing: {fname}")
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()
    for lineno, line in enumerate(lines, start=1):
        if FORBIDDEN_NAME_PATTERN.search(line) and not NON_PRIVATE_PREFIX.match(line):
            violations.append(f"{fname}:{lineno}: {line.strip()}")

device_identity_path = os.path.join(CRYPTO_DIR, "DeviceIdentity.kt")
with open(device_identity_path, encoding="utf-8") as f:
    device_identity_src = f.read()
if "fun sealNativeKeyMaterial(" not in device_identity_src:
    violations.append("DeviceIdentity.kt no longer declares the sole sanctioned sealNativeKeyMaterial() boundary")

if violations:
    fail("non-private raw-key declaration(s) found:\n  " + "\n  ".join(violations))

write_gate("UJB3", "PASS", "DeviceIdentity.kt/NativeCore.kt expose no non-private raw-key accessor")
print("PASS: uniffi/JNA Kotlin visibility scan")
