import fs from 'node:fs';
const [repo,sha,workflowList]=process.argv.slice(2);
if(!/^[\w.-]+\/[\w.-]+$/.test(repo??'') || !/^[a-f0-9]{40}$/.test(sha??'')) throw Error('Usage: node verify-ci-runs.mjs owner/repo FULL_SHA workflow1.yml,workflow2.yml');
const workflows=(workflowList??'').split(',').filter(Boolean);
if(!workflows.length) throw Error('Required workflow IDs missing');
const token=process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if(!token) throw Error('Authenticated GitHub token required');
const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
const checks=[];
for(const workflow of workflows){
  const url=`https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?head_sha=${sha}&per_page=100`;
  const res=await fetch(url,{headers});
  if(!res.ok) throw Error(`GitHub API ${res.status} for ${workflow}`);
  const body=await res.json();
  const runs=(body.workflow_runs??[]).filter(r=>r.head_sha===sha && r.status==='completed' && r.conclusion==='success');
  if(!runs.length) throw Error(`No successful completed run: ${workflow} @ ${sha}`);
  const run=runs.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
  checks.push({workflow,runId:run.id,runAttempt:run.run_attempt,url:run.html_url,headSha:sha,conclusion:run.conclusion});
}
fs.mkdirSync('certification/out',{recursive:true});
fs.writeFileSync('certification/out/ci-verification.json',JSON.stringify({sha,repo,checkedAt:new Date().toISOString(),checks},null,2));
console.log('Authenticated CI workflow checks passed; inspect job/test artifacts separately.');
