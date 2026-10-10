import {Router} from 'express'; import {VaultService} from './VaultService';
export function buildVaultV1Routes(service:VaultService){const r=Router();
 r.post('/workspace/consumer',async(req:any,res,next)=>{try{res.json(await service.ensureConsumerWorkspace(req.user.id))}catch(e){next(e)}});
 r.post('/uploads',async(req:any,res,next)=>{try{res.status(201).json(await service.createUpload({userId:req.user.id,sessionId:req.user.sessionId},req.body))}catch(e){next(e)}});
 r.post('/uploads/:id/complete',async(req:any,res,next)=>{try{res.json(await service.completeUpload({userId:req.user.id},req.params.id))}catch(e){next(e)}});
 return r;}
