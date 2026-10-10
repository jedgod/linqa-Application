import fs from "node:fs";
import path from "node:path";

const roots=["server/src/tests","clients/mobile"];
const offenders=[];
function walk(p){
  if(!fs.existsSync(p)) return;
  for(const e of fs.readdirSync(p,{withFileTypes:true})){
    const f=path.join(p,e.name);
    if(e.isDirectory()) walk(f);
    else if(/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(e.name)){
      const s=fs.readFileSync(f,"utf8");
      const lines=s.split(/\r?\n/);
      lines.forEach((line,i)=>{
        if(/\b(it|test|describe)\.skip\s*\(/.test(line))
          offenders.push(`${f}:${i+1}: explicit skip`);
        if(/\b(it|test|describe)\.only\s*\(/.test(line))
          offenders.push(`${f}:${i+1}: .only`);
      });
    }
  }
}
roots.forEach(walk);
if(offenders.length){
  console.error(offenders.join("\n"));
  process.exit(3);
}
console.log("No explicit .skip/.only found.");
