import {execFileSync} from 'node:child_process';
const sha=process.env.GITHUB_SHA;
if(!/^[a-f0-9]{40}$/.test(sha??'')) throw Error('Full GITHUB_SHA required');
const verifier=process.env.LINQA_APPROVED_GATE_VERIFIER;
if(!verifier || !verifier.startsWith('./scripts/')) throw Error('Trusted repository gate verifier path required');
execFileSync(verifier,[sha],{stdio:'inherit',shell:false,timeout:300000});
console.log('Approved gate verifier passed; release approval and branch protection remain separate requirements.');
