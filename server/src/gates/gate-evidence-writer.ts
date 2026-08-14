import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GateCheck, GateEvidence, GateName } from "./types.js";

export class GateEvidenceWriter {
  constructor(private readonly rootDir:string,private readonly revision:string,private readonly environment:GateEvidence["environment"]) {
    if (!revision || revision === "unknown") throw new Error("VERIFIABLE_REVISION_REQUIRED");
  }
  async write(gate:GateName,checks:GateCheck[]) {
    if (!checks.some((check)=>check.required)) throw new Error("REQUIRED_GATE_CHECKS_MISSING");
    for (const check of checks) if (check.required && check.passed && check.evidenceRefs.length===0) throw new Error(`EVIDENCE_REFERENCE_REQUIRED:${check.id}`);
    const required=checks.filter((check)=>check.required); const passed=required.filter((check)=>check.passed);
    const evidence:GateEvidence={schemaVersion:1,gate,status:passed.length===required.length?"GREEN":passed.length?"AMBER":"RED",generatedAt:new Date().toISOString(),revision:this.revision,environment:this.environment,checks,summary:{required:required.length,passed:passed.length,failed:required.length-passed.length}};
    const directory=join(this.rootDir,gate); await mkdir(directory,{recursive:true});
    const canonical=JSON.stringify(evidence,null,2)+"\n"; await writeFile(join(directory,"gate-evidence.json"),canonical);
    await writeFile(join(directory,"gate-evidence.sha256"),`${createHash("sha256").update(canonical).digest("hex")}  gate-evidence.json\n`);
    return evidence;
  }
}
