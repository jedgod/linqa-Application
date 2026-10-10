import fs from "node:fs";

const checks=[
 ["routes","server/src/routes/countrylinqa/routes.ts"],
 ["discovery","server/src/services/countrylinqa/discovery.ts"],
 ["feed scope","server/src/services/countrylinqa/feed-scope.ts"],
 ["service","server/src/services/countrylinqa/service.ts"],
 ["mobile service","clients/mobile/services/countrylinqa.service.ts"],
 ["world UI","clients/mobile/app/countrylinqa/world.tsx"],
 ["list UI","clients/mobile/app/countrylinqa/list.tsx"],
 ["settings UI","clients/mobile/app/settings/countrylinqa.tsx"],
 ["country confirmation","clients/mobile/app/onboarding/country-confirmation.tsx"],
 ["discovery onboarding","clients/mobile/app/onboarding/country-discovery.tsx"],
 ["onboarding complete","clients/mobile/app/onboarding/complete.tsx"],
 ["resolver","clients/mobile/app/onboarding/resolve.tsx"]
];

let fail=0;
for(const [name,p] of checks){
  const ok=fs.existsSync(p);
  console.log(`${ok?"PASS":"FAIL"} ${name}: ${p}`);
  if(!ok) fail++;
}
if(fail) process.exit(2);
