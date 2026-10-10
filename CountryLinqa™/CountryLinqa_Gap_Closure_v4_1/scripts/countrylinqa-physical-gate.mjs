import fs from "node:fs";
const p=process.argv[2] ?? "certification/countrylinqa/physical-evidence.json";
if(!fs.existsSync(p)) throw new Error("PHYSICAL_EVIDENCE_MISSING");
const e=JSON.parse(fs.readFileSync(p,"utf8"));

const required=[
 "gitSha","serverSha256","androidSha256","countryA","countryB",
 "deviceA","deviceB","myCountry","selectedCountries","region","worldwide",
 "inboundPrivacy","block","restrictedUser","savedSearch","pagination","cachePolicyChange"
];
for(const k of required) if(!e[k]) throw new Error(`MISSING:${k}`);

for(const k of [
 "myCountry","selectedCountries","region","worldwide","inboundPrivacy",
 "block","restrictedUser","savedSearch","pagination","cachePolicyChange"
]) if(e[k]!=="PASS") throw new Error(`NOT_PASS:${k}`);

if(e.countryA===e.countryB) throw new Error("TWO_DISTINCT_COUNTRIES_REQUIRED");

if(e.iosRequired===true && e.iosPhysical!=="PASS")
  throw new Error("IOS_PHYSICAL_PENDING");

console.log("COUNTRYLINQA_PHYSICAL_GATE=PASS");
