import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const must=[
  "server/src/routes/countrylinqa/routes.ts",
  "server/src/services/countrylinqa/discovery.ts",
  "server/src/services/countrylinqa/feed-scope.ts",
  "server/src/services/countrylinqa/service.ts",
  "clients/mobile/services/countrylinqa.service.ts",
  "clients/mobile/app/countrylinqa/world.tsx",
  "clients/mobile/app/countrylinqa/list.tsx",
  "clients/mobile/app/settings/countrylinqa.tsx"
];

const optional=[
  "server/src/services/countrylinqa/golive/businessRanking.ts",
  "server/src/services/countrylinqa/golive/eventRanking.ts",
  "server/src/tests/countrylinqa-parity-invariants.test.ts",
  "scripts/unified-onboarding-release-gate.mjs"
];

const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const rows=[...must.map(p=>({p,required:true})),...optional.map(p=>({p,required:false}))].map(x=>({
  path:x.p, required:x.required, exists:fs.existsSync(x.p),
  sha256:fs.existsSync(x.p)?sha(x.p):null
}));

const migrationDir="server/src/db/migrations";
const migrations=fs.existsSync(migrationDir)
  ? fs.readdirSync(migrationDir).filter(x=>/^\d+_.*\.sql$/.test(x)).sort()
  : [];

const nums=migrations.map(x=>Number(x.match(/^(\d+)_/)?.[1]||0));
const nextMigration=(Math.max(0,...nums)+1).toString().padStart(3,"0");

const out={generatedAt:new Date().toISOString(),rows,migrations,nextMigration};
fs.writeFileSync("countrylinqa-repo-inventory.json",JSON.stringify(out,null,2));

const missing=rows.filter(x=>x.required&&!x.exists);
console.log(JSON.stringify(out,null,2));
if(missing.length) process.exitCode=2;
