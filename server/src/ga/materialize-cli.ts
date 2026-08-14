import { materializeG5Assurance } from "./materialize-g5-assurance.js";
const envelopePath=process.env.LINQA_G5_SIGNED_ENVELOPE;const publicKey=process.env.LINQA_EVIDENCE_SIGNING_PUBLIC_KEY_PEM;const revision=process.env.GIT_SHA;const releaseVersion=process.env.RELEASE_VERSION;
if(!envelopePath||!publicKey||!revision||!releaseVersion)throw new Error("LINQA_G5_SIGNED_ENVELOPE, LINQA_EVIDENCE_SIGNING_PUBLIC_KEY_PEM, GIT_SHA, and RELEASE_VERSION are required");
const payload=await materializeG5Assurance({envelopePath,publicKey,evidenceRoot:process.env.LINQA_G5_EVIDENCE_ROOT??"release-evidence/g5",revision,releaseVersion});console.log(`Materialized ${payload.gates.length} G5 gates for ${releaseVersion} @ ${revision}`);
