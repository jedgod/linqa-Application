import {spawnSync} from "node:child_process";
import fs from "node:fs";

function run(label,cmd,args,cwd="."){
  console.log(`\n=== ${label} ===`);
  const r=spawnSync(cmd,args,{
    cwd,stdio:"inherit",shell:process.platform==="win32",
    env:process.env
  });
  if((r.status ?? 1)!==0) throw new Error(`${label}_FAILED`);
}

const dirty=spawnSync("git",["status","--porcelain"],{
  encoding:"utf8",shell:process.platform==="win32"
}).stdout?.trim();

if(dirty){
  console.error("Working tree is not clean.");
  console.error("Commit/stash unrelated edits before release certification.");
  process.exit(2);
}

run("Skip audit","node",["scripts/audit-vitest-skips.mjs"]);
run("DB test gate","node",["scripts/countrylinqa-db-test-gate.mjs"]);

if(fs.existsSync("server/package.json")){
  run("Server build","npm",["run","build"],"server");
  run("Server tests","npm",["test"],"server");
}
if(fs.existsSync("clients/mobile/package.json")){
  run("Mobile typecheck","npm",["run","typecheck"],"clients/mobile");
}

console.log("\nCOUNTRYLINQA_CERT_PREFLIGHT=PASS");
