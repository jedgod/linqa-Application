import fs from "node:fs";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";

const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const dirty=execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim();
if (dirty) throw new Error("REFUSE_CERTIFICATION_DIRTY_WORKTREE");

const digest=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const server=process.env.SERVER_ARTIFACT;
const mobile=process.env.MOBILE_ARTIFACT;
if(!server||!mobile) throw new Error("SERVER_ARTIFACT_AND_MOBILE_ARTIFACT_REQUIRED");

const manifest={
  schemaVersion:1,
  gitSha:sha,
  serverArtifact:{path:server,sha256:digest(server)},
  mobileArtifact:{path:mobile,sha256:digest(mobile)},
  migrationLevel:43,
  createdAt:new Date().toISOString()
};

fs.writeFileSync("countrylinqa-release-manifest.json",JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest,null,2));
