import fs from "node:fs";
import {execFileSync} from "node:child_process";

const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const status=execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim();

const report={
  generatedAt:new Date().toISOString(),
  gitSha:sha,
  cleanWorktree:status.length===0,
  software:{
    serverTests:process.env.CLQ_SERVER_TESTS ?? "UNKNOWN",
    dbIntegration:process.env.CLQ_DB_TESTS ?? "UNKNOWN",
    redisTests:process.env.CLQ_REDIS_TESTS ?? "UNKNOWN",
    mobileTypecheck:process.env.CLQ_MOBILE_TYPECHECK ?? "UNKNOWN",
    workflow:process.env.CLQ_WORKFLOW ?? "NOT_RUN"
  },
  physical:{
    twoCountryAndroid:process.env.CLQ_ANDROID_PHYSICAL ?? "PENDING",
    ios:process.env.CLQ_IOS_PHYSICAL ?? "BLOCKED_NO_IOS_PROJECT"
  }
};

report.releaseReady =
  report.cleanWorktree &&
  Object.values(report.software).every(x=>x==="PASS") &&
  report.physical.twoCountryAndroid==="PASS";

fs.mkdirSync("certification/countrylinqa",{recursive:true});
fs.writeFileSync(
  "certification/countrylinqa/release-readiness.json",
  JSON.stringify(report,null,2)
);
console.log(JSON.stringify(report,null,2));
if(!report.releaseReady) process.exitCode=5;
