#!/usr/bin/env python3
"""Checks that the Android and Expo CountryLinqa clients carry the same
real surface — the same DiscoveryMode enum values the server actually
defines (`server/src/db/migrations/020_countrylinqa.sql`'s
`country_discovery_mode` type: MY_COUNTRY, SELECTED_COUNTRIES, REGION,
GLOBAL) and the same top-level LinqaWorld entry points (Businesses, Events,
Communities). Adapted from an earlier draft of this check that assumed a
`CROSS_COUNTRIES` term — the real enum value, confirmed against the live
migration and both native clients, is `SELECTED_COUNTRIES`.
"""
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


def read(path):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        return ""
    with open(full, encoding="utf-8", errors="ignore") as f:
        return f.read()


REQUIRED_MODE_TERMS = ["MY_COUNTRY", "SELECTED_COUNTRIES", "REGION", "GLOBAL"]
REQUIRED_SURFACE_TERMS = ["Businesses", "Events", "Communities"]

android_mode_sources = "".join(
    read(p)
    for p in [
        "clients/android/app/src/main/java/com/linqa/app/ui/screens/CountryDiscoverySettingsScreen.kt",
        "clients/android/app/src/main/java/com/linqa/app/ui/screens/CountryPickerScreen.kt",
        "clients/android/app/src/main/java/com/linqa/app/ui/screens/CountryScopeOnboardingScreen.kt",
    ]
)
mobile_mode_source = read("clients/mobile/services/countrylinqa.service.ts")

android_world_source = read("clients/android/app/src/main/java/com/linqa/app/ui/screens/LinqaWorldScreen.kt")
mobile_world_source = read("clients/mobile/app/countrylinqa/world.tsx")

violations = []
for term in REQUIRED_MODE_TERMS:
    if term not in android_mode_sources:
        violations.append(f"Android CountryLinqa mode screens missing term `{term}`")
    if term not in mobile_mode_source:
        violations.append(f"Expo countrylinqa.service.ts missing term `{term}`")

for term in REQUIRED_SURFACE_TERMS:
    if term not in android_world_source:
        violations.append(f"Android LinqaWorldScreen.kt missing surface entry `{term}`")
    if term not in mobile_world_source:
        violations.append(f"Expo countrylinqa/world.tsx missing surface entry `{term}`")

if violations:
    write_gate("CL2", "FAIL", "; ".join(violations))
    print("FAIL: mobile parity violations:", file=sys.stderr)
    for v in violations:
        print(f"  - {v}", file=sys.stderr)
    sys.exit(1)

write_gate("CL2", "PASS", "Android and Expo CountryLinqa clients share the real mode enum and world-surface terms")
print("PASS: countrylinqa mobile parity")
