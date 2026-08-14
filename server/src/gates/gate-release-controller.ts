import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GateEvidence, GateName } from "./types.js";
const REQUIRED:GateName[]=["G0","G1","G2","G3","G4"];
export async function assertG0ToG4Green(rootDir:string,expectedRevision:string) {
  const failures:string[]=[];
  for(const gate of REQUIRED){
    try{
      const canonical=await readFile(join(rootDir,gate,"gate-evidence.json"),"utf8");
      const expected=(await readFile(join(rootDir,gate,"gate-evidence.sha256"),"utf8")).trim().split(/\s+/)[0];
      if(createHash("sha256").update(canonical).digest("hex")!==expected)failures.push(`${gate}:DIGEST_MISMATCH`);
      const evidence=JSON.parse(canonical) as GateEvidence;
      if(evidence.gate!==gate||evidence.status!=="GREEN")failures.push(`${gate}:NOT_GREEN`);
      if(evidence.revision!==expectedRevision)failures.push(`${gate}:REVISION_MISMATCH`);
      if(evidence.environment==="staging")failures.push(`${gate}:PRODUCTION_EQUIVALENT_REQUIRED`);
      if(evidence.summary.failed!==0||evidence.checks.some((check)=>check.required&&(!check.passed||check.evidenceRefs.length===0)))failures.push(`${gate}:CHECKS_INCOMPLETE`);
    }catch(error){failures.push(`${gate}:MISSING_OR_INVALID:${String(error)}`);}
  }
  if(failures.length)throw new Error(`LINQA_RELEASE_BLOCKED:${failures.join(",")}`);
}
