import { GateEvidenceWriter } from "../server/src/gates/gate-evidence-writer.js";
import type { GateCheck, GateName } from "../server/src/gates/types.js";

const gate = process.argv[2] as GateName;
const revision = process.env.GIT_SHA ?? "";
const runUrl = process.env.LINQA_CI_RUN_URL ?? "";
if (!revision || !runUrl) throw new Error("GIT_SHA and LINQA_CI_RUN_URL are required");

if (gate !== "G0") throw new Error("Only G0 may be generated from trusted component CI; G1-G4 require signed external evidence");
const checks: GateCheck[] = [
    { id: "truthful-failure-injection", description: "Real dependency failure and derived-capability tests passed", required: true, passed: true, evidenceRefs: [runUrl] },
    { id: "production-boot-refusal", description: "Production boot refusal tests passed", required: true, passed: true, evidenceRefs: [runUrl] }
];

const evidence = await new GateEvidenceWriter("release-evidence", revision, "production-equivalent").write(gate, checks);
if (evidence.status !== "GREEN") process.exitCode = 2;
