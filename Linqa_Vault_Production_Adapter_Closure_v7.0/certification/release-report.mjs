import {execFileSync} from 'node:child_process'; import {createHash} from 'node:crypto'; import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs'; import {join} from 'node:path';
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const root=process.argv[2]||'.'; const rows=[];
function walk(p){for(const n of readdirSync(p)){const f=join(p,n),s=statSync(f);if(s.isDirectory()&&!f.includes('node_modules')&&!f.includes('.git'))walk(f);else if(s.isFile()){const b=readFileSync(f);rows.push({file:f,sha256:createHash('sha256').update(b).digest('hex')})}}}
walk(root); rows.sort((a,b)=>a.file.localeCompare(b.file));
const artifactDigest=createHash('sha256').update(rows.map(x=>`${x.sha256}  ${x.file}`).join('\n')).digest('hex');
const report={generatedAt:new Date().toISOString(),gitSha:sha,artifactDigest,files:rows};
writeFileSync('vault-release-report.json',JSON.stringify(report,null,2)); console.log(JSON.stringify({gitSha:sha,artifactDigest,fileCount:rows.length},null,2));
