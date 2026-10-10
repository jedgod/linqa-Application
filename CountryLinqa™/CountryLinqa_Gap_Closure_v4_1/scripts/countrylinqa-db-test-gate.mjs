import {spawnSync} from "node:child_process";

if(!process.env.DATABASE_URL){
  console.error("DATABASE_URL is required for CountryLinqa certification.");
  process.exit(2);
}
process.env.LINQA_REQUIRE_DB_TESTS="1";

const args=[
  "vitest","run",
  "server/src/tests/countrylinqa-engine.integration.test.ts",
  "--reporter=verbose"
];
const r=spawnSync("npx",args,{stdio:"inherit",shell:process.platform==="win32",env:process.env});
process.exit(r.status ?? 1);
