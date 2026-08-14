import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import type { AssuranceEnvironment, EvidenceArtifact, SubmittedEvidenceArtifact } from "./types.js";

const digest = (value:Buffer|string) => createHash("sha256").update(value).digest("hex");
const validId = (value:string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/.test(value);

export class EvidenceRegistry {
  private readonly verified=new Map<string,EvidenceArtifact>();
  constructor(private readonly root:string,private readonly revision:string,private readonly releaseVersion:string,private readonly environment:AssuranceEnvironment) {}

  async register(bundleRoot:string,input:SubmittedEvidenceArtifact):Promise<EvidenceArtifact> {
    if(!validId(input.id))throw new Error(`EVIDENCE_ID_INVALID:${input.id}`);
    if(input.revision!==this.revision||input.releaseVersion!==this.releaseVersion||input.environment!==this.environment)throw new Error(`EVIDENCE_BINDING_INVALID:${input.id}`);
    const safeRoot=await realpath(bundleRoot); const source=await realpath(resolve(safeRoot,input.path));
    if(source!==safeRoot&&!source.startsWith(`${safeRoot}${sep}`))throw new Error(`EVIDENCE_PATH_ESCAPE:${input.id}`);
    const bytes=await readFile(source); if(bytes.length!==input.bytes||digest(bytes)!==input.sha256.toLowerCase())throw new Error(`EVIDENCE_CONTENT_MISMATCH:${input.id}`);
    const directory=join(this.root,"artifacts",input.id); await mkdir(directory,{recursive:true});
    const storedPath=["artifacts",input.id,basename(source)].join("/");
    try { await stat(join(directory,"artifact.json")); throw new Error(`EVIDENCE_IMMUTABLE:${input.id}`); } catch(error) { if(error instanceof Error&&error.message.startsWith("EVIDENCE_IMMUTABLE"))throw error;if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error; }
    await copyFile(source,join(this.root,storedPath));
    const artifact:EvidenceArtifact={schemaVersion:1,id:input.id,type:input.type,storedPath,sha256:input.sha256.toLowerCase(),bytes:input.bytes,producedAt:input.producedAt,producer:input.producer,environment:input.environment,revision:input.revision,releaseVersion:input.releaseVersion,...(input.metadata?{metadata:input.metadata}:{})};
    const canonical=`${JSON.stringify(artifact,null,2)}\n`; await writeFile(join(directory,"artifact.json"),canonical); await writeFile(join(directory,"artifact.sha256"),`${digest(canonical)}  artifact.json\n`);
    this.verified.set(input.id,artifact);
    return artifact;
  }

  async getVerified(id:string):Promise<EvidenceArtifact> {
    if(!validId(id))throw new Error(`EVIDENCE_ID_INVALID:${id}`);
    const cached=this.verified.get(id);if(cached)return cached;
    const directory=join(this.root,"artifacts",id); const canonical=await readFile(join(directory,"artifact.json"),"utf8");
    const expected=(await readFile(join(directory,"artifact.sha256"),"utf8")).trim().split(/\s+/)[0];
    if(digest(canonical)!==expected)throw new Error(`EVIDENCE_MANIFEST_TAMPERED:${id}`);
    const artifact=JSON.parse(canonical) as EvidenceArtifact;
    if(artifact.id!==id||artifact.revision!==this.revision||artifact.releaseVersion!==this.releaseVersion||artifact.environment!==this.environment)throw new Error(`EVIDENCE_BINDING_INVALID:${id}`);
    const contentPath=resolve(this.root,artifact.storedPath);const safeRoot=resolve(this.root);if(contentPath!==safeRoot&&!contentPath.startsWith(`${safeRoot}${sep}`))throw new Error(`EVIDENCE_PATH_ESCAPE:${id}`);
    const content=await readFile(contentPath); if(content.length!==artifact.bytes||digest(content)!==artifact.sha256)throw new Error(`EVIDENCE_CONTENT_MISMATCH:${id}`);
    this.verified.set(id,artifact);return artifact;
  }
}
