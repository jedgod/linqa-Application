import { execFileSync } from 'node:child_process';
const git = (...args) => execFileSync('git',args,{encoding:'utf8'}).trim();
const branch=git('branch','--show-current');
if(branch!=='agent/production-module-hardening') throw Error(`Unexpected branch: ${branch}`);
if(git('status','--porcelain')) throw Error('Working tree not clean; commit and review changes first');
const sha=git('rev-parse','HEAD');
if(!/^[a-f0-9]{40}$/.test(sha)) throw Error('Invalid SHA');
console.log(JSON.stringify({branch,sha,clean:true}));
