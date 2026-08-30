import type { Request, Response, NextFunction } from 'express';
import { can } from '../shared/permissions';
import type { StaffRole } from '../shared/ops-types';

export interface OpsRequest extends Request { staff?: {id:string; role:StaffRole; sessionId:string}; correlationId?: string; }

export const requirePermission = (permission:string)=>(req:OpsRequest,res:Response,next:NextFunction)=>{
  if(!req.staff) return res.status(401).json({error:'UNAUTHENTICATED'});
  if(!can(req.staff.role,permission)) return res.status(403).json({error:'FORBIDDEN',permission});
  next();
};

export function redactClientForRole<T extends Record<string,any>>(obj:T, role:StaffRole){
  const clone = structuredClone(obj);
  delete clone.passwordHash; delete clone.e2eeKeys; delete clone.recoverySecret;
  delete clone.fullCardNumber; delete clone.cvv; delete clone.vaultPlaintext;
  if(!can(role,'client:sensitive')) { delete clone.govIdRaw; delete clone.fullPhone; delete clone.fullEmail; }
  return clone;
}

export function requireReason(req:OpsRequest,res:Response,next:NextFunction){
  const reason = req.header('x-ops-reason');
  if(!reason || reason.length < 5) return res.status(400).json({error:'REASON_REQUIRED'});
  next();
}
