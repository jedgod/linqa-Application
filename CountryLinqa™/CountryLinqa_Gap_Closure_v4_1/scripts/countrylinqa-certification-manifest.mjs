import fs from "node:fs";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";

const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const dirty=execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim();
if(dirty) throw new Error("CLEAN_WORKTREE_REQUIRED");

const digest=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const server=process.env.COUNTRYLINQA_SERVER_ARTIFACT;
const android=process.env.COUNTRYLINQA_ANDROID_ARTIFACT;
const ios=process.env.COUNTRYLINQA_IOS_ARTIFACT;

if(!server||!android) throw new Error("SERVER_AND_ANDROID_ARTIFACTS_REQUIRED");

const manifest={
 schemaVersion:1,
 gitSha:sha,
 generatedAt:new Date().toISOString(),
 server:{path:server,sha256:digest(server)},
 android:{path:android,sha256:digest(android)},
 ios:ios?{path:ios,sha256:digest(ios)}:null,
 physicalCertification:{
   countryA:"PENDING",
   countryB:"PENDING",
   android:"PENDING",
   ios:ios?"PENDING":"BLOCKED_NO_IOS_ARTIFACT"
 }
};
fs.writeFileSync("countrylinqa-certification-manifest.json",JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest,null,2));
