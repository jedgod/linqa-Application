import { assertG0ToG4Green } from "../server/src/gates/gate-release-controller.js";

const revision = process.env.GIT_SHA ?? "";
if (!revision) throw new Error("GIT_SHA is required");
await assertG0ToG4Green(process.env.LINQA_EVIDENCE_ROOT ?? "release-evidence", revision);
console.log(`G0-G4 release evidence is GREEN for ${revision}`);
