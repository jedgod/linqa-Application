import { Router } from 'express';
import { P } from '../shared/permissions';
import { requirePermission, requireReason } from './security';

export const opsRouter = Router();

// Staff Management
opsRouter.get('/staff', requirePermission(P.STAFF_READ), async (_req,res)=>res.json({items:[]}));
opsRouter.post('/staff/:id/status', requirePermission(P.STAFF_MANAGE), requireReason, async (req,res)=>res.json({ok:true,staffId:req.params.id}));
opsRouter.post('/staff/:id/role', requirePermission(P.STAFF_MANAGE), requireReason, async (req,res)=>res.json({ok:true,staffId:req.params.id,role:req.body.role}));

// Client 360
opsRouter.get('/clients/:id/360', requirePermission(P.CLIENT_360), async (req,res)=>res.json({id:req.params.id,summary:{}}));

// Cases and real-time support
opsRouter.get('/cases', requirePermission(P.CASE_READ), async (_req,res)=>res.json({items:[]}));
opsRouter.post('/cases/:id/assign', requirePermission(P.CASE_ASSIGN), requireReason, async (req,res)=>res.json({ok:true,assignee:req.body.staffId}));
opsRouter.post('/cases/:id/escalate', requirePermission(P.CASE_ESCALATE), requireReason, async (req,res)=>res.json({ok:true}));
opsRouter.post('/cases/:id/messages', requirePermission(P.CHAT_REPLY), async (req,res)=>res.status(201).json({id:crypto.randomUUID(),body:req.body.body}));

// LinqaSend Investigation — metadata/state only, never expose payment secrets.
opsRouter.get('/send/transactions/:id', requirePermission(P.SEND_INVESTIGATE), async (req,res)=>res.json({id:req.params.id,state:'REVIEW'}));
opsRouter.post('/send/transactions/:id/action', requirePermission(P.SEND_ACTION), requireReason, async (req,res)=>res.json({ok:true,action:req.body.action}));

// Vault quarantine — staff can review scanner metadata, hashes and policy findings; plaintext remains unavailable.
opsRouter.get('/vault/quarantine', requirePermission(P.VAULT_REVIEW), async (_req,res)=>res.json({items:[]}));
opsRouter.post('/vault/quarantine/:id/action', requirePermission(P.VAULT_ACTION), requireReason, async (req,res)=>res.json({ok:true}));

// Recovery
opsRouter.get('/recovery/:caseId', requirePermission(P.RECOVERY_REVIEW), async (req,res)=>res.json({caseId:req.params.caseId,signals:[]}));
opsRouter.post('/recovery/:caseId/decision', requirePermission(P.RECOVERY_ACTION), requireReason, async (req,res)=>res.json({ok:true,decision:req.body.decision}));

// Trust & Safety
opsRouter.get('/trust/cases', requirePermission(P.TRUST_REVIEW), async (_req,res)=>res.json({items:[]}));
opsRouter.post('/trust/cases/:id/decision', requirePermission(P.TRUST_ACTION), requireReason, async (req,res)=>res.json({ok:true}));

// Fraud / Risk
opsRouter.get('/risk/cases', requirePermission(P.FRAUD_REVIEW), async (_req,res)=>res.json({items:[]}));
opsRouter.post('/risk/cases/:id/action', requirePermission(P.FRAUD_ACTION), requireReason, async (req,res)=>res.json({ok:true}));

// Coaching + Workforce
opsRouter.get('/qa/reviews', requirePermission(P.QA_REVIEW), async (_req,res)=>res.json({items:[]}));
opsRouter.post('/coaching/sessions', requirePermission(P.COACHING_MANAGE), async (_req,res)=>res.status(201).json({ok:true}));
opsRouter.get('/workforce/schedule', requirePermission(P.WORKFORCE_READ), async (_req,res)=>res.json({items:[]}));
opsRouter.post('/workforce/schedule', requirePermission(P.WORKFORCE_MANAGE), async (_req,res)=>res.status(201).json({ok:true}));

// Incident Command
opsRouter.get('/incidents', requirePermission(P.INCIDENT_READ), async (_req,res)=>res.json({items:[]}));
opsRouter.post('/incidents', requirePermission(P.INCIDENT_MANAGE), requireReason, async (_req,res)=>res.status(201).json({id:crypto.randomUUID()}));
opsRouter.post('/incidents/:id/status', requirePermission(P.INCIDENT_MANAGE), requireReason, async (req,res)=>res.json({ok:true,id:req.params.id}));

// Executive analytics + audit
opsRouter.get('/analytics/executive', requirePermission(P.ANALYTICS_EXEC), async (_req,res)=>res.json({kpis:{}}));
opsRouter.get('/audit', requirePermission(P.AUDIT_READ), async (_req,res)=>res.json({items:[]}));
