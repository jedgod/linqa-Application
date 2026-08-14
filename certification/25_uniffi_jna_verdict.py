#!/usr/bin/env python3
import json, os, datetime

root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
evdir = os.environ.get("LINQA_EVIDENCE_DIR", os.path.join(root, "certification", "evidence"))
gp = os.path.join(evdir, "gates.json")

with open(gp, encoding="utf-8") as f:
    gates = json.load(f)

required = ["UJB1", "UJB2", "UJB3", "UJB4", "UJB5"]
failed = [g for g in required if gates.get(g, {}).get("status") != "PASS"]

verdict = {
    "status": "GREEN" if not failed else "RED",
    "required": required,
    "failed": failed,
    "note": (
        "UJB1-5 cover the real UniFFI/JNA binding surface only "
        "(clients/android app/src/main/java/uniffi/linqa_core), not raw JNI, "
        "which does not exist in this repo. Instrumentation test results "
        "(IdentityImportBoundaryInstrumentationTest) are recorded separately "
        "under app/build/outputs/androidTest-results since they require a "
        "connected device/emulator and aren't run by this static suite."
    ),
    "evaluatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}

with open(os.path.join(evdir, "uniffi-jna-verdict.json"), "w", encoding="utf-8") as f:
    json.dump(verdict, f, indent=2)

print(json.dumps(verdict, indent=2))
if failed:
    raise SystemExit(1)
