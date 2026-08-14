import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe,expect,it } from "vitest";
import { GateEvidenceWriter } from "../gates/gate-evidence-writer.js";
import { assertG0ToG4Green } from "../gates/gate-release-controller.js";
import { REQUIRED_EXTERNAL_CHECKS, verifySignedGateEvidence } from "../gates/signed-gate-evidence.js";

describe("green-gate evidence integrity",()=>{
  it("refuses green checks without concrete evidence references",async()=>{
    const root=await mkdtemp(join(tmpdir(),"linqa-evidence-")); const writer=new GateEvidenceWriter(root,"abc123","production-equivalent");
    await expect(writer.write("G0",[{id:"truth",description:"truth",required:true,passed:true,evidenceRefs:[]}])).rejects.toThrow("EVIDENCE_REFERENCE_REQUIRED");
  });
  it("hashes evidence and blocks tampering or missing gates",async()=>{
    const root=await mkdtemp(join(tmpdir(),"linqa-evidence-")); const writer=new GateEvidenceWriter(root,"abc123","production-equivalent");
    for(const gate of ["G0","G1","G2","G3","G4"] as const)await writer.write(gate,[{id:`${gate}-verified`,description:"executed gate",required:true,passed:true,evidenceRefs:["test-report.xml"]}]);
    await expect(assertG0ToG4Green(root,"abc123")).resolves.toBeUndefined();
    const file=join(root,"G2","gate-evidence.json"); await writeFile(file,(await readFile(file,"utf8")).replace('"GREEN"','"RED"'));
    await expect(assertG0ToG4Green(root,"abc123")).rejects.toThrow("DIGEST_MISMATCH");
  });
  it("accepts only signed, revision-bound, complete external evidence",()=>{
    const {privateKey,publicKey}=generateKeyPairSync("ed25519");
    const payload=Buffer.from(JSON.stringify({gate:"G3",revision:"abc123",environment:"production-equivalent",checks:REQUIRED_EXTERNAL_CHECKS.G3.map((id)=>({id,description:id,required:true,passed:true,evidenceRefs:[`device-farm://${id}`]}))}));
    const envelope={payloadBase64:payload.toString("base64"),signatureBase64:sign(null,payload,privateKey).toString("base64")};
    expect(verifySignedGateEvidence(envelope,publicKey.export({type:"spki",format:"pem"}).toString(),"G3","abc123").gate).toBe("G3");
    expect(()=>verifySignedGateEvidence({...envelope,payloadBase64:Buffer.from(payload.toString().replace("abc123","other")).toString("base64")},publicKey.export({type:"spki",format:"pem"}).toString(),"G3","abc123")).toThrow("SIGNATURE_INVALID");
    expect(()=>verifySignedGateEvidence(envelope,publicKey.export({type:"spki",format:"pem"}).toString(),"G3","other")).toThrow("BINDING_INVALID");
  });
});
