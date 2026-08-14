import { assertProductionGAGreen } from "./ga-release-controller.js";
const revision=process.env.GIT_SHA,releaseVersion=process.env.RELEASE_VERSION,publicKey=process.env.LINQA_EVIDENCE_SIGNING_PUBLIC_KEY_PEM,g5Root=process.env.LINQA_G5_EVIDENCE_ROOT??"release-evidence/g5";
if(!revision||!releaseVersion||!publicKey)throw new Error("GIT_SHA, RELEASE_VERSION, and LINQA_EVIDENCE_SIGNING_PUBLIC_KEY_PEM are required");
await assertProductionGAGreen({g0ToG4Root:process.env.LINQA_G0_G4_EVIDENCE_ROOT??"release-evidence",g5Root,revision,releaseVersion,publicKey});console.log(`G0-G5 production GA evidence is GREEN for ${releaseVersion} @ ${revision}`);
