#!/usr/bin/env python3
import json, os, datetime

root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
evdir = os.environ.get("LINQA_EVIDENCE_DIR", os.path.join(root, "certification", "evidence"))
gp = os.path.join(evdir, "gates.json")

with open(gp, encoding="utf-8") as f:
    gates = json.load(f)

required = ["CPK1", "CPK2", "CPK3"]
failed = [g for g in required if gates.get(g, {}).get("status") != "PASS"]

verdict = {
    "status": "GREEN" if not failed else "RED",
    "required": required,
    "failed": failed,
    "evaluatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}

with open(os.path.join(evdir, "private-key-boundary-verdict.json"), "w", encoding="utf-8") as f:
    json.dump(verdict, f, indent=2)

print(json.dumps(verdict, indent=2))
if failed:
    raise SystemExit(1)
