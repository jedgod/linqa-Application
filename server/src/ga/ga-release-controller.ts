import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertG0ToG4Green } from "../gates/gate-release-controller.js";
import { EvidenceRegistry } from "./evidence-registry.js";
import { G5_REQUIREMENTS } from "./requirements.js";
import { G5_SUB_GATES,type AssuranceEnvironment,type G5GateEvidence } from "./types.js";
import { verifySignedG5Assurance } from "./signed-assurance-verifier.js";
import type { SignedG5AssuranceEnvelope } from "./types.js";

export async function assertG5Green(root:string,revision:string,releaseVersion:string,environment:AssuranceEnvironment){
  const registry=new EvidenceRegistry(root,revision,releaseVersion,environment);const failures:string[]=[];
  for(const gate of G5_SUB_GATES){
    try{
      const canonical=await readFile(join(root,gate,"gate-evidence.json"),"utf8");const expected=(await readFile(join(root,gate,"gate-evidence.sha256"),"utf8")).trim().split(/\s+/)[0];
      if(createHash("sha256").update(canonical).digest("hex")!==expected)throw new Error("DIGEST_MISMATCH");
      const evidence=JSON.parse(canonical) as G5GateEvidence;
      if(evidence.schemaVersion!==1||evidence.gate!==gate||evidence.status!=="GREEN"||evidence.revision!==revision||evidence.releaseVersion!==releaseVersion||evidence.environment!==environment||evidence.summary.failed!==0)throw new Error("NOT_GREEN_OR_BINDING_INVALID");
      const required=G5_REQUIREMENTS[gate],ids=evidence.checks.map((check)=>check.id);if(ids.length!==required.length||required.some((id)=>!ids.includes(id)))throw new Error("REQUIREMENTS_INCOMPLETE");
      for(const check of evidence.checks){if(!check.required||!check.passed||check.evidenceIds.length===0)throw new Error(`CHECK_FAILED:${check.id}`);for(const id of check.evidenceIds)await registry.getVerified(id);}
    }catch(error){failures.push(`${gate}:${error instanceof Error?error.message:String(error)}`);}
  }
  if(failures.length)throw new Error(`LINQA_G5_BLOCKED:${failures.join(",")}`);
}

export async function assertProductionGAGreen(input:{g0ToG4Root:string;g5Root:string;revision:string;releaseVersion:string;publicKey:string}){
  const envelopeText=await readFile(join(input.g5Root,"signed-assurance.json"),"utf8");const expected=(await readFile(join(input.g5Root,"signed-assurance.sha256"),"utf8")).trim().split(/\s+/)[0];
  if(createHash("sha256").update(envelopeText).digest("hex")!==expected)throw new Error("G5_SIGNED_ENVELOPE_TAMPERED");
  const payload=verifySignedG5Assurance(JSON.parse(envelopeText) as SignedG5AssuranceEnvelope,input.publicKey,input.revision,input.releaseVersion);
  await assertG0ToG4Green(input.g0ToG4Root,input.revision);await assertG5Green(input.g5Root,input.revision,input.releaseVersion,payload.environment);
}
