import { readFile } from "node:fs/promises";
import { GateEvidenceWriter } from "../server/src/gates/gate-evidence-writer.js";
import type { GateCheck, GateName } from "../server/src/gates/types.js";
const gate=process.argv[2] as GateName; const checkFile=process.env.LINQA_GATE_CHECK_FILE;
if(!checkFile)throw new Error("LINQA_GATE_CHECK_FILE required");
const checks=JSON.parse(await readFile(checkFile,"utf8")) as GateCheck[];
const writer=new GateEvidenceWriter(process.env.LINQA_EVIDENCE_ROOT??"release-evidence",process.env.GIT_SHA??"",(process.env.LINQA_EVIDENCE_ENV??"production-equivalent") as "production-equivalent");
const evidence=await writer.write(gate,checks); console.log(JSON.stringify(evidence)); if(evidence.status!=="GREEN")process.exitCode=2;
