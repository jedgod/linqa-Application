import fs from 'node:fs';import crypto from 'node:crypto';
const required=['gitSha','artifactSha256','dbMigration','iosPhysical','androidPhysical','replayTests','transferMutationTests','revokedDeviceTests','attestationPolicy','auditVerification','monitoring','rollbackDrill'];
const file=process.argv[2];if(!file){console.error('usage: node release-gate.mjs evidence.json');process.exit(2)}
const e=JSON.parse(fs.readFileSync(file,'utf8'));const missing=required.filter(k=>!e[k]);if(missing.length){console.error('RELEASE BLOCKED missing:',missing.join(', '));process.exit(3)}
if(!/^[0-9a-f]{40,64}$/i.test(e.gitSha)){console.error('RELEASE BLOCKED invalid gitSha');process.exit(4)}
if(!/^[0-9a-f]{64}$/i.test(e.artifactSha256)){console.error('RELEASE BLOCKED invalid artifactSha256');process.exit(5)}
console.log('BIOMETRIC V5 RELEASE GATE: PASS');console.log('evidence digest:',crypto.createHash('sha256').update(JSON.stringify(e)).digest('hex'));
