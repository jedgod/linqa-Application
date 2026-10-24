#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] || 'clients/mobile/app');
const out = path.resolve(process.argv[3] || 'evidence/route-audit.json');
const files = [];
function walk(dir) { for (const entry of fs.readdirSync(dir, {withFileTypes:true})) { const p=path.join(dir,entry.name); if(entry.isDirectory()) walk(p); else if(/\.(tsx|ts|jsx|js)$/.test(entry.name)) files.push(path.relative(root,p).replaceAll('\\','/')); } }
if(!fs.existsSync(root)){ console.error('Missing Expo Router directory: '+root);process.exit(2); }
walk(root);
const pageFiles=files.filter(f=>!f.split('/').some(s=>s.startsWith('+') || s.startsWith('_')) && !/\.(test|spec)\./.test(f));
const pages=pageFiles.map(f=>{const segments=f.replace(/\.(tsx|ts|jsx|js)$/,'').split('/').filter(s=>!/^\(.*\)$/.test(s));if(segments.at(-1)==='index')segments.pop();return {file:f, route:'/'+segments.join('/')};});
const report={root,generatedAt:new Date().toISOString(),filesScanned:files.length,pages,notes:['Dynamic segments require runtime params.','Route groups do not appear in public paths.','Manual review required for redirects, authorization and deep links.']};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(`Audited ${pages.length} page files -> ${out}`);
