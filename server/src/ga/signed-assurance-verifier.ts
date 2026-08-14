import { verify } from "node:crypto";
import { G5_REQUIREMENTS } from "./requirements.js";
import { G5_SUB_GATES,type G5AssurancePayload,type G5SubGate,type SignedG5AssuranceEnvelope,type SubmittedEvidenceArtifact } from "./types.js";

const independentTypes:Partial<Record<G5SubGate,string>>={"G5-A":"CRYPTO_REVIEW","G5-B":"PEN_TEST","G5-H":"PRIVACY_REVIEW","G5-K":"GO_NO_GO_APPROVALS"};
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};

function validateIndependent(gate:G5SubGate,artifacts:SubmittedEvidenceArtifact[]){
  const type=independentTypes[gate];if(!type)return;
  const matching=artifacts.filter((artifact)=>artifact.type===type);
  if(matching.length!==1)throw new Error(`G5_INDEPENDENT_ARTIFACT_REQUIRED:${gate}`);
  const artifact=matching[0]!;const metadata=object(artifact.metadata);
  if(["linqa","linqa-ci","github-actions"].includes(artifact.producer.toLowerCase()))throw new Error(`G5_INDEPENDENCE_INVALID:${gate}`);
  if(metadata.approved!==true)throw new Error(`G5_EXTERNAL_APPROVAL_MISSING:${gate}`);
  if(gate==="G5-A"||gate==="G5-B"){
    if(metadata.criticalOpen!==0)throw new Error(`G5_OPEN_CRITICAL_FINDINGS:${gate}`);
    if(gate==="G5-A"&&metadata.highOpen!==0)throw new Error("G5_OPEN_HIGH_CRYPTO_FINDINGS");
  }
  if(gate==="G5-K"){
    const roles=Array.isArray(metadata.roles)?metadata.roles:[];
    for(const role of ["ENGINEERING","SECURITY","SRE","PRIVACY_LEGAL","PRODUCT"])if(!roles.includes(role))throw new Error(`G5_APPROVAL_ROLE_MISSING:${role}`);
  }
}

export function verifySignedG5Assurance(envelope:SignedG5AssuranceEnvelope,publicKey:string,expectedRevision:string,expectedReleaseVersion:string,now=new Date()):G5AssurancePayload{
  if(!/^[a-f0-9]{40,64}$/i.test(expectedRevision)||!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedReleaseVersion))throw new Error("G5_RELEASE_IDENTITY_INVALID");
  const bytes=Buffer.from(envelope.payloadBase64,"base64");
  if(!verify(null,bytes,publicKey,Buffer.from(envelope.signatureBase64,"base64")))throw new Error("G5_ASSURANCE_SIGNATURE_INVALID");
  const payload=JSON.parse(bytes.toString("utf8")) as G5AssurancePayload;
  if(payload.schemaVersion!==1||payload.revision!==expectedRevision||payload.releaseVersion!==expectedReleaseVersion)throw new Error("G5_ASSURANCE_BINDING_INVALID");
  if(payload.environment!=="production-equivalent"&&payload.environment!=="production")throw new Error("G5_ASSURANCE_ENVIRONMENT_INVALID");
  const issued=Date.parse(payload.issuedAt),expires=Date.parse(payload.expiresAt),current=now.getTime();
  if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>current+300_000||expires<=current||expires-issued>7*86_400_000)throw new Error("G5_ASSURANCE_TIME_INVALID");
  if(new Set(payload.artifacts.map((artifact)=>artifact.id)).size!==payload.artifacts.length)throw new Error("G5_DUPLICATE_ARTIFACT_ID");
  for(const artifact of payload.artifacts){
    if(artifact.revision!==expectedRevision||artifact.releaseVersion!==expectedReleaseVersion||artifact.environment!==payload.environment)throw new Error(`G5_ARTIFACT_BINDING_INVALID:${artifact.id}`);
    const produced=Date.parse(artifact.producedAt);const external=["CRYPTO_REVIEW","PEN_TEST","PRIVACY_REVIEW"].includes(artifact.type);const maxAge=(external?366:30)*86_400_000;
    if(!/^[a-f0-9]{64}$/i.test(artifact.sha256)||!Number.isSafeInteger(artifact.bytes)||artifact.bytes<1||!Number.isFinite(produced)||produced>current+300_000||current-produced>maxAge)throw new Error(`G5_ARTIFACT_METADATA_INVALID:${artifact.id}`);
  }
  if(new Set(payload.gates.map((entry)=>entry.gate)).size!==G5_SUB_GATES.length||payload.gates.length!==G5_SUB_GATES.length)throw new Error("G5_GATE_SET_INVALID");
  const artifactIds=new Set(payload.artifacts.map((artifact)=>artifact.id));
  for(const gate of G5_SUB_GATES){
    const entry=payload.gates.find((candidate)=>candidate.gate===gate);if(!entry)throw new Error(`G5_GATE_MISSING:${gate}`);
    const required=G5_REQUIREMENTS[gate],ids=entry.checks.map((check)=>check.id);
    if(new Set(ids).size!==ids.length||ids.length!==required.length||required.some((id)=>!ids.includes(id)))throw new Error(`G5_REQUIREMENTS_MISMATCH:${gate}`);
    for(const check of entry.checks){if(!check.required||!check.passed||check.evidenceIds.length===0)throw new Error(`G5_CHECK_NOT_GREEN:${gate}:${check.id}`);for(const id of check.evidenceIds)if(!artifactIds.has(id))throw new Error(`G5_UNKNOWN_EVIDENCE:${gate}:${check.id}:${id}`);}
    const linked=new Set(entry.checks.flatMap((check)=>check.evidenceIds));validateIndependent(gate,payload.artifacts.filter((artifact)=>linked.has(artifact.id)));
  }
  return payload;
}
