import { createHash,generateKeyPairSync,sign } from "node:crypto";
import { mkdir,mkdtemp,readFile,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe,expect,it } from "vitest";
import { GateEvidenceWriter } from "../gates/gate-evidence-writer.js";
import { assertLoadGate,assertRecoveryObjectives,assertRollbackCompatible,decideCanary } from "../ga/assurance-policies.js";
import { assertG5Green,assertProductionGAGreen } from "../ga/ga-release-controller.js";
import { materializeG5Assurance } from "../ga/materialize-g5-assurance.js";
import { G5_REQUIREMENTS } from "../ga/requirements.js";
import { verifySignedG5Assurance } from "../ga/signed-assurance-verifier.js";
import { G5_SUB_GATES,type G5AssurancePayload,type SignedG5AssuranceEnvelope,type SubmittedEvidenceArtifact } from "../ga/types.js";

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),"linqa-g5-")),bundle=join(root,"bundle"),evidence=join(root,"evidence");await mkdir(bundle);
  const revision="0123456789abcdef0123456789abcdef01234567",releaseVersion="v1.2.3";
  const definitions=[
    ["crypto","CRYPTO_REVIEW","Independent Cryptography Lab",{approved:true,criticalOpen:0,highOpen:0}],
    ["pentest","PEN_TEST","Independent Security Lab",{approved:true,criticalOpen:0,highOpen:2}],
    ["privacy","PRIVACY_REVIEW","Independent Privacy Counsel",{approved:true}],
    ["approvals","GO_NO_GO_APPROVALS","Release Board",{approved:true,roles:["ENGINEERING","SECURITY","SRE","PRIVACY_LEGAL","PRODUCT"]}],
    ["ci","CI_ASSURANCE","trusted-assurance-service",{approved:true}]
  ] as const;
  const artifacts:SubmittedEvidenceArtifact[]=[];
  for(const [id,type,producer,metadata] of definitions){const path=`${id}.json`,bytes=Buffer.from(JSON.stringify({id,type,passed:true}));await writeFile(join(bundle,path),bytes);artifacts.push({id:`evidence_${id}`,type,path,sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,producedAt:new Date().toISOString(),producer,environment:"production-equivalent",revision,releaseVersion,metadata});}
  const special:Record<string,string>={"G5-A":"evidence_crypto","G5-B":"evidence_pentest","G5-H":"evidence_privacy","G5-K":"evidence_approvals"};
  const payload:G5AssurancePayload={schemaVersion:1,revision,releaseVersion,environment:"production-equivalent",issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3_600_000).toISOString(),artifacts,gates:G5_SUB_GATES.map((gate)=>({gate,checks:G5_REQUIREMENTS[gate].map((id)=>({id,description:id,required:true,passed:true,evidenceIds:[special[gate]??"evidence_ci"]}))}))};
  const {privateKey,publicKey}=generateKeyPairSync("ed25519"),payloadBytes=Buffer.from(JSON.stringify(payload));const envelope={payloadBase64:payloadBytes.toString("base64"),signatureBase64:sign(null,payloadBytes,privateKey).toString("base64")};const envelopePath=join(bundle,"signed-assurance.json");await writeFile(envelopePath,JSON.stringify(envelope));const publicKeyPem=publicKey.export({type:"spki",format:"pem"}).toString();
  return{root,bundle,evidence,revision,releaseVersion,envelopePath,publicKeyPem,payload,privateKey};
}

describe("G5 production assurance",()=>{
  it("materializes and re-verifies all eleven signed sub-gates",async()=>{const f=await fixture();await materializeG5Assurance({envelopePath:f.envelopePath,publicKey:f.publicKeyPem,evidenceRoot:f.evidence,revision:f.revision,releaseVersion:f.releaseVersion});await expect(assertG5Green(f.evidence,f.revision,f.releaseVersion,"production-equivalent")).resolves.toBeUndefined();},30_000);
  it("rejects changed evidence after registration",async()=>{const f=await fixture();await materializeG5Assurance({envelopePath:f.envelopePath,publicKey:f.publicKeyPem,evidenceRoot:f.evidence,revision:f.revision,releaseVersion:f.releaseVersion});const manifest=JSON.parse(await readFile(join(f.evidence,"artifacts","evidence_ci","artifact.json"),"utf8")) as {storedPath:string};await writeFile(join(f.evidence,manifest.storedPath),"tampered");await expect(assertG5Green(f.evidence,f.revision,f.releaseVersion,"production-equivalent")).rejects.toThrow("EVIDENCE_CONTENT_MISMATCH");},30_000);
  it("rejects signature tampering and self-attested independent review",async()=>{const f=await fixture();const envelope=JSON.parse(await readFile(f.envelopePath,"utf8")) as SignedG5AssuranceEnvelope;const changed=envelope.signatureBase64.startsWith("A")?"B":"A";expect(()=>verifySignedG5Assurance({...envelope,signatureBase64:`${changed}${envelope.signatureBase64.slice(1)}`},f.publicKeyPem,f.revision,f.releaseVersion)).toThrow("SIGNATURE_INVALID");const payload=structuredClone(f.payload);payload.artifacts.find((artifact)=>artifact.type==="CRYPTO_REVIEW")!.producer="linqa-ci";const bytes=Buffer.from(JSON.stringify(payload));expect(()=>verifySignedG5Assurance({payloadBase64:bytes.toString("base64"),signatureBase64:sign(null,bytes,f.privateKey).toString("base64")},f.publicKeyPem,f.revision,f.releaseVersion)).toThrow("INDEPENDENCE_INVALID");});
  it("admits GA only when G0-G4 and the original signed G5 envelope match",async()=>{const f=await fixture();await materializeG5Assurance({envelopePath:f.envelopePath,publicKey:f.publicKeyPem,evidenceRoot:f.evidence,revision:f.revision,releaseVersion:f.releaseVersion});const g0Root=join(f.root,"g0-g4"),writer=new GateEvidenceWriter(g0Root,f.revision,"production-equivalent");for(const gate of ["G0","G1","G2","G3","G4"] as const)await writer.write(gate,[{id:`${gate}-executed`,description:"executed",required:true,passed:true,evidenceRefs:["ci://run"]}]);await expect(assertProductionGAGreen({g0ToG4Root:g0Root,g5Root:f.evidence,revision:f.revision,releaseVersion:f.releaseVersion,publicKey:f.publicKeyPem})).resolves.toBeUndefined();await writeFile(join(f.evidence,"signed-assurance.json"),"{}");await expect(assertProductionGAGreen({g0ToG4Root:g0Root,g5Root:f.evidence,revision:f.revision,releaseVersion:f.releaseVersion,publicKey:f.publicKeyPem})).rejects.toThrow("SIGNED_ENVELOPE_TAMPERED");},30_000);
  it("enforces resilience and rollback thresholds",()=>{expect(()=>assertRecoveryObjectives({rpoSeconds:60,rtoSeconds:120,dataIntegrityPassed:true},{maxRpoSeconds:60,maxRtoSeconds:300})).not.toThrow();expect(()=>assertLoadGate({scenario:"relay",errorRate:.02,p95Ms:400,p99Ms:900,sustainedMinutes:60})).toThrow("LOAD_ERROR_RATE_EXCEEDED");expect(decideCanary({errorRate:.001,authFailureDelta:0,relayFailureDelta:0,crashFreeSessions:.999,securityAlertCount:1})).toBe("ROLLBACK");expect(()=>assertRollbackCompatible({deployedSchemaVersion:24,previousAppMinSchema:1,previousAppMaxSchema:23,destructiveMigrationApplied:false})).toThrow("ROLLBACK_SCHEMA_INCOMPATIBLE");});
});
