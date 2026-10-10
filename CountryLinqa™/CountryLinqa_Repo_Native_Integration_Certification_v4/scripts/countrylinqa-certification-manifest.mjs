import fs from "node:fs";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";

const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const dirty=execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim();
if(dirty) throw new Error("CERTIFICATION_REQUIRES_CLEAN_WORKTREE");

const digest=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const android=process.env.COUNTRYLINQA_ANDROID_APK;
const ios=process.env.COUNTRYLINQA_IOS_IPA;
const server=process.env.COUNTRYLINQA_SERVER_ARTIFACT;

if(!android||!server) throw new Error("ANDROID_APK_AND_SERVER_ARTIFACT_REQUIRED");

const manifest={
 schemaVersion:4,
 gitSha:sha,
 generatedAt:new Date().toISOString(),
 server:{path:server,sha256:digest(server)},
 android:{path:android,sha256:digest(android)},
 ios:ios?{path:ios,sha256:digest(ios)}:null,
 certification:{
   android:"PENDING_PHYSICAL_EXECUTION",
   ios:ios?"PENDING_PHYSICAL_EXECUTION":"NOT_YET_AVAILABLE"
 }
};
fs.writeFileSync("countrylinqa-certification-manifest.json",JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest,null,2));
