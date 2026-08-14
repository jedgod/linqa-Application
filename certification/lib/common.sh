#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVIDENCE_DIR="${LINQA_EVIDENCE_DIR:-$ROOT/certification/evidence}"
mkdir -p "$EVIDENCE_DIR"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

write_gate() {
  local gate="$1" status="$2" detail="$3"
  python3 - "$EVIDENCE_DIR/gates.json" "$gate" "$status" "$detail" <<'PY'
import json,sys,os,datetime
path,gate,status,detail=sys.argv[1:]
data={}
if os.path.exists(path):
    with open(path,encoding="utf-8") as f:data=json.load(f)
data[gate]={
  "status":status,
  "detail":detail,
  "recordedAt":datetime.datetime.now(datetime.timezone.utc).isoformat()
}
tmp=path+".tmp"
with open(tmp,"w",encoding="utf-8") as f:
    json.dump(data,f,indent=2,sort_keys=True)
os.replace(tmp,path)
PY
}
