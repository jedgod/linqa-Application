import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EvidenceRegistry } from "./evidence-registry.js";
import { G5EvidenceWriter } from "./g5-evidence-writer.js";
import { verifySignedG5Assurance } from "./signed-assurance-verifier.js";
import type { SignedG5AssuranceEnvelope } from "./types.js";

export async function materializeG5Assurance(input:{envelopePath:string;publicKey:string;evidenceRoot:string;revision:string;releaseVersion:string}){
  const envelopeText=await readFile(input.envelopePath,"utf8");const envelope=JSON.parse(envelopeText) as SignedG5AssuranceEnvelope;
  const payload=verifySignedG5Assurance(envelope,input.publicKey,input.revision,input.releaseVersion);
  const registry=new EvidenceRegistry(input.evidenceRoot,input.revision,input.releaseVersion,payload.environment);
  for(const artifact of payload.artifacts)await registry.register(dirname(input.envelopePath),artifact);
  const writer=new G5EvidenceWriter(input.evidenceRoot,registry,input.revision,input.releaseVersion,payload.environment);
  for(const entry of payload.gates)await writer.write(entry.gate,entry.checks);
  await mkdir(input.evidenceRoot,{recursive:true});const stored=join(input.evidenceRoot,"signed-assurance.json");await copyFile(input.envelopePath,stored);
  await writeFile(join(input.evidenceRoot,"signed-assurance.sha256"),`${createHash("sha256").update(envelopeText).digest("hex")}  signed-assurance.json\n`);
  return payload;
}
