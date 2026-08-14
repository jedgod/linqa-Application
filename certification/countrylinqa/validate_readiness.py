#!/usr/bin/env python3
"""Fails closed if readiness.json claims a capability true that this
checkout cannot actually back up with a real file/route, so the JSON can't
silently drift from reality over time."""
import json, os, sys, datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EVIDENCE_DIR = os.environ.get("LINQA_EVIDENCE_DIR", os.path.join(ROOT, "certification", "evidence"))
os.makedirs(EVIDENCE_DIR, exist_ok=True)
READINESS = os.path.join(ROOT, "certification", "countrylinqa", "readiness.json")

BACKING_PATHS = {
    "backendDiscoveryPreferences": "server/src/services/countrylinqa/service.ts",
    "backendCountryVerification": "server/src/services/countrylinqa/service.ts",
    "backendEntitlements": "server/src/services/countrylinqa/entitlements.ts",
    "backendGoLiveFeatures": "server/src/services/countrylinqa/golive",
    "backendSecurityFeatures": "server/src/services/countrylinqa/security",
    "androidWorldSurface": "clients/android/app/src/main/java/com/linqa/app/ui/screens/LinqaWorldScreen.kt",
    "expoWorldSurface": "clients/mobile/app/countrylinqa/world.tsx",
    "adminModeration": "server/src/routes/countrylinqa/admin-routes.ts",
}


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
for key, backing in BACKING_PATHS.items():
    claimed = readiness.get(key)
    exists = os.path.exists(os.path.join(ROOT, backing))
    if claimed and not exists:
        violations.append(f"readiness.json claims `{key}: true` but {backing} does not exist")

if violations:
    write_gate("CL3", "FAIL", "; ".join(violations))
    print("FAIL:", violations, file=sys.stderr)
    sys.exit(1)

write_gate("CL3", "PASS", "countrylinqa readiness.json claims are all backed by real files")
print("PASS: countrylinqa readiness validated")
