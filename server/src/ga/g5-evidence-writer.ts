import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { G5_REQUIREMENTS } from "./requirements.js";
import type { AssuranceEnvironment,G5Check,G5GateEvidence,G5SubGate } from "./types.js";
import type { EvidenceRegistry } from "./evidence-registry.js";

export class G5EvidenceWriter {
  constructor(private readonly root:string,private readonly registry:EvidenceRegistry,private readonly revision:string,private readonly releaseVersion:string,private readonly environment:AssuranceEnvironment) {}
  async write(gate:G5SubGate,checks:G5Check[]):Promise<G5GateEvidence>{
    const required=G5_REQUIREMENTS[gate]; const ids=checks.map((check)=>check.id);
    if(new Set(ids).size!==ids.length||required.some((id)=>!ids.includes(id))||ids.some((id)=>!required.includes(id)))throw new Error(`G5_REQUIREMENTS_MISMATCH:${gate}`);
    for(const check of checks){
      if(!check.required)throw new Error(`G5_REQUIRED_FLAG_FALSE:${gate}:${check.id}`);
      if(check.passed&&check.evidenceIds.length===0)throw new Error(`G5_EVIDENCE_REQUIRED:${gate}:${check.id}`);
      for(const evidenceId of check.evidenceIds)await this.registry.getVerified(evidenceId);
    }
    const passed=checks.filter((check)=>check.passed).length;
    const evidence:G5GateEvidence={schemaVersion:1,gate,status:passed===checks.length?"GREEN":passed?"AMBER":"RED",generatedAt:new Date().toISOString(),revision:this.revision,releaseVersion:this.releaseVersion,environment:this.environment,checks,summary:{required:checks.length,passed,failed:checks.length-passed}};
    const directory=join(this.root,gate);await mkdir(directory,{recursive:true});const canonical=`${JSON.stringify(evidence,null,2)}\n`;
    await writeFile(join(directory,"gate-evidence.json"),canonical);await writeFile(join(directory,"gate-evidence.sha256"),`${createHash("sha256").update(canonical).digest("hex")}  gate-evidence.json\n`);return evidence;
  }
}
