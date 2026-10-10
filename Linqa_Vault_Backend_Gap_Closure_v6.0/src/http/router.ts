import {Router} from 'express'; import type {Principal} from '../adapters/contracts';
export type Services={files:any;intake:any;share:any;privateVault:any;security:any;billing:any};
const p=(req:any)=>req.principal as Principal; const asyncRoute=(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve(fn(req,res,next)).catch(next);
export function createVaultGapRouter(s:Services){const r=Router();
r.get('/files',asyncRoute(async(req,res)=>res.json(await s.files.list(p(req),{workspaceId:String(req.query.workspaceId),folderId:req.query.folderId as string|undefined,limit:Number(req.query.limit||50),cursor:req.query.cursor as string|undefined}))));
r.post('/imports/:kind',asyncRoute(async(req,res)=>res.status(202).json(await s.intake.request(p(req),{...req.body,kind:String(req.params.kind).toUpperCase()}))));
r.post('/imports/:id/process',asyncRoute(async(req,res)=>res.json(await s.intake.process(p(req),req.params.id))));
r.post('/imports/:id/finalize-ciphertext',asyncRoute(async(req,res)=>res.json(await s.intake.finalizeCiphertext(p(req),{...req.body,intakeId:req.params.id}))));
r.post('/share/linqa-user',asyncRoute(async(req,res)=>res.status(201).json(await s.share.linqaUser(p(req),req.body))));
r.post('/share/vault-to-vault',asyncRoute(async(req,res)=>res.status(201).json(await s.share.vaultToVault(p(req),req.body))));
r.post('/share/secure-links',asyncRoute(async(req,res)=>res.status(201).json(await s.share.secureLink(p(req),req.body))));
r.post('/share/email',asyncRoute(async(req,res)=>res.status(202).json(await s.share.email(p(req),req.body))));
r.post('/exports/social/authorize',asyncRoute(async(req,res)=>res.status(201).json(await s.share.authorizeSocial(p(req),req.body))));
r.post('/exports/social/:grantId/execute',asyncRoute(async(req,res)=>res.json(await s.share.executeSocial(p(req),req.params.grantId))));
r.post('/private/unlock',asyncRoute(async(req,res)=>res.json(await s.privateVault.unlock(p(req),req.body))));
r.post('/private/lock',asyncRoute(async(req,res)=>res.json(await s.privateVault.lock(p(req),req.body.sessionId))));
r.get('/security-center',asyncRoute(async(req,res)=>res.json(await s.security.get(p(req)))));r.put('/security-center/login-alerts',asyncRoute(async(req,res)=>res.json(await s.security.setLoginAlerts(p(req),!!req.body.enabled))));
r.post('/billing/checkout',asyncRoute(async(req,res)=>res.status(201).json(await s.billing.checkout(p(req),req.body))));
return r}
