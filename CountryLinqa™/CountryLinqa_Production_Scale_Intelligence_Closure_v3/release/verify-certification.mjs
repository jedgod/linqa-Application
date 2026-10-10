import fs from "node:fs";

const manifest=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const evidence=JSON.parse(fs.readFileSync(process.argv[3],"utf8"));

const required=[
  "gitSha","serverSha256","mobileSha256",
  "deviceA","deviceB","countryA","countryB",
  "myCountry","selectedCountries","region","worldwide",
  "inboundRestriction","block","pauseDiscovery",
  "filters","savedSearch","pagination","cacheInvalidation"
];

for(const k of required){
  if(evidence[k]===undefined||evidence[k]===null||evidence[k]==="")
    throw new Error(`MISSING_CERTIFICATION_FIELD:${k}`);
}

if(evidence.gitSha!==manifest.gitSha) throw new Error("GIT_SHA_MISMATCH");
if(evidence.serverSha256!==manifest.serverArtifact.sha256) throw new Error("SERVER_DIGEST_MISMATCH");
if(evidence.mobileSha256!==manifest.mobileArtifact.sha256) throw new Error("MOBILE_DIGEST_MISMATCH");

const tests=[
  "myCountry","selectedCountries","region","worldwide",
  "inboundRestriction","block","pauseDiscovery",
  "filters","savedSearch","pagination","cacheInvalidation"
];
for(const t of tests) if(evidence[t]!=="PASS") throw new Error(`CERTIFICATION_FAILED:${t}`);

console.log("COUNTRYLINQA_CERTIFICATION_GATE=PASS");
