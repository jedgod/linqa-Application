#!/usr/bin/env python3
"""Additive Closure / No Duplicates: guards against re-introducing any of
the parallel-architecture mistakes this repo has already had to reject
across several implementation packs — a second backend framework, a second
native-binding mechanism, a second web framework, or a second copy of a
service directory under a near-miss name. Every check here corresponds to
a real, specific incident from this codebase's history, not a hypothetical.

Fails closed: an unknown/ambiguous state is treated as a violation, not a
pass, consistent with every other fail-closed gate in certification/.
"""
import json
import os
import re
import sys
import datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EVIDENCE_DIR = os.environ.get("LINQA_EVIDENCE_DIR", os.path.join(ROOT, "certification", "evidence"))
os.makedirs(EVIDENCE_DIR, exist_ok=True)


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


violations = []


def check(label, condition, detail):
    if condition:
        violations.append(f"{label}: {detail}")


def file_contains(path, pattern):
    if not os.path.exists(path):
        return False
    with open(path, encoding="utf-8", errors="ignore") as f:
        return re.search(pattern, f.read()) is not None


def any_path_exists(*rel_paths):
    return [p for p in rel_paths if os.path.exists(os.path.join(ROOT, p))]


# --- ND-01: no second backend framework alongside the real Fastify server.
nest_markers = any_path_exists("server/nest-cli.json", "backend/nest-cli.json", "api-gateway")
check("ND-01", bool(nest_markers), f"NestJS/parallel-backend markers found: {nest_markers}")
check(
    "ND-01",
    file_contains(os.path.join(ROOT, "server", "package.json"), r"@nestjs/"),
    "server/package.json depends on @nestjs/* alongside the real Fastify stack",
)
express_pkg = os.path.join(ROOT, "server", "package.json")
check(
    "ND-01",
    file_contains(express_pkg, r'"express"\s*:'),
    "server/package.json depends on express alongside the real Fastify stack",
)

# --- ND-02: no raw-JNI native binding alongside the real UniFFI/JNA one.
check(
    "ND-02",
    bool(any_path_exists("core/src/android_ffi.rs", "core/src/jni_bridge.rs")),
    "a parallel raw-JNI Rust module exists alongside core/src/uniffi_api.rs",
)
check(
    "ND-02",
    file_contains(os.path.join(ROOT, "core", "src", "lib.rs"), r"pub mod\s+(android_ffi|jni_bridge)\b"),
    "core/src/lib.rs declares a parallel raw-JNI module",
)

# --- ND-03: no second web framework alongside the real Vite+React client.
check(
    "ND-03",
    bool(any_path_exists("clients/web/next.config.js", "clients/web/next.config.ts", "clients/web/pages")),
    "a Next.js `pages/`-router structure exists alongside the real Vite+React client (clients/web/src)",
)
check(
    "ND-03",
    file_contains(os.path.join(ROOT, "clients", "web", "package.json"), r'"next"\s*:'),
    "clients/web/package.json depends on next alongside the real Vite stack",
)

# --- ND-04: no near-miss duplicate service directories for the three
# feature packs this repo already has one real, casing-canonical
# implementation of.
canonical_service_dirs = {
    "countrylinqa": os.path.join(ROOT, "server", "src", "services", "countrylinqa"),
    "linqasend": os.path.join(ROOT, "server", "src", "services", "linqasend"),
    "file-vault.service.ts": os.path.join(ROOT, "server", "src", "services", "file-vault.service.ts"),
}
near_miss_names = {
    "countrylinqa": ["country-linqa", "countryLinqa", "country_linqa"],
    "linqasend": ["linqa-send", "linqaSend", "linqa_send"],
}
services_root = os.path.join(ROOT, "server", "src", "services")
if os.path.isdir(services_root):
    existing = set(os.listdir(services_root))
    for canonical, near_misses in near_miss_names.items():
        found = [n for n in near_misses if n in existing]
        check("ND-04", bool(found), f"near-miss duplicate of services/{canonical}: {found}")

for label, path in canonical_service_dirs.items():
    check(f"ND-04:{label}", not os.path.exists(path), f"expected canonical implementation missing: {path}")

# --- ND-05: no second Android crypto facade alongside the real NativeCore/DeviceIdentity.
android_crypto_root = os.path.join(ROOT, "clients", "android", "app", "src", "main", "java")
duplicate_facades = any_path_exists(
    "clients/android/app/src/main/java/com/linqa/core/NativeCoreFacade.kt",
    "clients/android/src/main/java",  # the pre-restructure path several packs assumed
)
check("ND-05", bool(duplicate_facades), f"parallel Android crypto facade / stale source root found: {duplicate_facades}")

if violations:
    write_gate("ND1", "FAIL", "; ".join(violations))
    print("FAIL: no-duplicate-architecture violations found:", file=sys.stderr)
    for v in violations:
        print(f"  - {v}", file=sys.stderr)
    sys.exit(1)

write_gate("ND1", "PASS", "no parallel backend/native-binding/web-framework/service-directory duplication detected")
print("PASS: no duplicate architecture")
