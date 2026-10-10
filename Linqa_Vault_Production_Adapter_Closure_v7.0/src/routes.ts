import {Router} from 'express'; import type {LiveLinqaBindings} from './live/live-bindings.js';
export function vaultProductionRoutes(b:LiveLinqaBindings,svc:any){
 const r=Router();
 const auth=(fn:any)=>async(req:any,res:any,next:any)=>{try{const p=await b.principal.require(req);await fn(p,req,res)}catch(e){next(e)}};
 r.post('/v1/vault/imports/:kind',auth(async(p:any,req:any,res:any)=>res.status(202).json(await svc.intake.import(p,req.params.kind,req.body.sourceRef))));
 r.post('/v1/vault/imports/:id/scan',auth(async(p:any,req:any,res:any)=>res.json(await svc.intake.scan(p,req.params.id))));
 r.post('/v1/vault/imports/:id/handoff',auth(async(p:any,req:any,res:any)=>res.json(await svc.intake.handoff(p,req.params.id))));
 r.get('/v1/vault/security',auth(async(p:any,_req:any,res:any)=>res.json(await svc.security.get(p))));
 r.post('/v1/vault/billing/checkout',auth(async(p:any,req:any,res:any)=>res.json(await svc.billing.checkout(p,req.body.planCode,req.body.successUrl,req.body.cancelUrl))));
 // Billing webhook MUST be mounted with raw-body middleware before express.json().
 r.post('/v1/vault/billing/webhook',async(req:any,res,next)=>{try{res.json(await svc.billing.webhook(req.body,req.headers))}catch(e){next(e)}});
 r.get('/internal/ready/vault',async(_req,res)=>{try{await svc.readiness();res.json({ready:true})}catch(e:any){res.status(503).json({ready:false,reason:String(e?.message||'READINESS_FAILED')})}});
 return r;
}
