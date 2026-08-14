import { readFile } from "node:fs/promises";
import { GateEvidenceWriter } from "../server/src/gates/gate-evidence-writer.js";
import { verifySignedGateEvidence, type SignedEvidenceEnvelope } from "../server/src/gates/signed-gate-evidence.js";
import type { GateName } from "../server/src/gates/types.js";

const gate=process.argv[2] as GateName; const file=process.argv[3];
if(!["G0","G1","G2","G3","G4"].includes(gate)||!file)throw new Error("usage: verify-signed-gate-evidence G0|G1|G2|G3|G4 file");
const publicKey=process.env.LINQA_EVIDENCE_SIGNING_PUBLIC_KEY_PEM; const revision=process.env.GIT_SHA;
if(!publicKey||!revision)throw new Error("evidence signing key and GIT_SHA are required");
const envelope=JSON.parse(await readFile(file,"utf8")) as SignedEvidenceEnvelope;
const document=verifySignedGateEvidence(envelope,publicKey,gate,revision);
const evidence=await new GateEvidenceWriter(process.env.LINQA_EVIDENCE_ROOT??"release-evidence",revision,document.environment).write(gate,document.checks);
if(evidence.status!=="GREEN")process.exitCode=2;
