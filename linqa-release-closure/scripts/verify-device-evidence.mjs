import fs from 'node:fs';
const [manifestPath,sha]=process.argv.slice(2);
if(!manifestPath || !/^[a-f0-9]{40}$/.test(sha??'')) throw Error('Usage: node verify-device-evidence.mjs MANIFEST FULL_SHA');
const data=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
if(data.commitSha!==sha) throw Error('Device evidence SHA mismatch');
const required=['android-two-account','ios-physical','lifecycle'];
for(const kind of required){
 const record=(data.records??[]).find(x=>x.kind===kind);
 if(!record || record.result!=='pass' || !record.deviceId || !record.testRunId || !record.artifactDigest || !/^sha256:[a-f0-9]{64}$/.test(record.artifactDigest) || !record.evidenceUri) throw Error(`Missing or incomplete ${kind} evidence`);
}
console.log('Device evidence metadata complete; signatures and artifact authenticity require approved verifier.');
