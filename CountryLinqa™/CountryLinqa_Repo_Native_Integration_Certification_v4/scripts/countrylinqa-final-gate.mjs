import fs from "node:fs";

const evidencePath=process.argv[2] ?? "certification/countrylinqa/evidence.json";
if(!fs.existsSync(evidencePath)) throw new Error("CERTIFICATION_EVIDENCE_MISSING");
const e=JSON.parse(fs.readFileSync(evidencePath,"utf8"));

const required=[
 "gitSha","serverSha256","androidSha256","androidPhysical",
 "myCountry","selectedCountries","region","worldwide",
 "inboundPrivacy","pauseDiscovery","block",
 "advancedFilters","savedSearch","pagination","cacheInvalidation"
];

for(const k of required){
 if(e[k]===undefined||e[k]===null||e[k]==="")
   throw new Error(`MISSING:${k}`);
}

const pass=[
 "androidPhysical","myCountry","selectedCountries","region","worldwide",
 "inboundPrivacy","pauseDiscovery","block","advancedFilters",
 "savedSearch","pagination","cacheInvalidation"
];
for(const k of pass) if(e[k]!=="PASS") throw new Error(`NOT_PASS:${k}`);

if(e.iosRequired===true && e.iosPhysical!=="PASS")
 throw new Error("IOS_PHYSICAL_CERTIFICATION_REQUIRED");

console.log("COUNTRYLINQA_REPO_NATIVE_GATE=PASS");
