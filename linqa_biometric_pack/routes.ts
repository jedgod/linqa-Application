import { Router } from 'express';
import { z } from 'zod';
import type { BiometricStepUpService } from './service';
import type { Principal } from './types';

type Req = Express.Request & { principal: Principal };

export function biometricRoutes(service: BiometricStepUpService) {
  const r=Router();

  r.post('/v1/security/biometrics/enroll',async(req,res,next)=>{
    try {
      const body=z.object({
        platform:z.enum(['IOS','ANDROID']),
        publicKeySpkiBase64:z.string().min(40),
        keyAlias:z.string().min(3).max(120),
      }).parse(req.body);
      res.status(201).json(await service.enroll({principal:(req as Req).principal,...body}));
    } catch(e){next(e)}
  });

  r.post('/v1/security/biometrics/challenges',async(req,res,next)=>{
    try {
      const body=z.object({purpose:z.string(),resource:z.unknown()}).parse(req.body);
      res.json(await service.createChallenge({
        principal:(req as Req).principal,
        purpose:body.purpose as any,
        resource:body.resource
      }));
    } catch(e){next(e)}
  });

  r.post('/v1/security/biometrics/verify',async(req,res,next)=>{
    try {
      const body=z.object({
        challengeId:z.string().uuid(),challenge:z.string().min(20),signatureBase64:z.string().min(40)
      }).parse(req.body);
      res.json(await service.verify({principal:(req as Req).principal,...body}));
    } catch(e){next(e)}
  });

  r.delete('/v1/security/biometrics/:credentialId',async(req,res,next)=>{
    try {
      await service.revoke((req as Req).principal,req.params.credentialId);
      res.status(204).end();
    } catch(e){next(e)}
  });

  return r;
}
