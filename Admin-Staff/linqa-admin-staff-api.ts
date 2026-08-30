/** Express-style API contract and policy middleware blueprint. */
import type { NextFunction, Request, Response } from 'express';
import { ROLE_PERMISSIONS, type AdminRole, type Permission } from './linqa-admin-staff-types';

type StaffPrincipal = { staffId: string; role: AdminRole; sessionId: string; mfaFresh: boolean };

declare global { namespace Express { interface Request { staff?: StaffPrincipal } } }

export const requirePermission = (permission: Permission) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.staff) return res.status(401).json({ error: 'STAFF_AUTH_REQUIRED' });
  const allowed = ROLE_PERMISSIONS[req.staff.role]?.includes(permission);
  if (!allowed) return res.status(403).json({ error: 'PERMISSION_DENIED', permission });
  next();
};

export const requireFreshMfa = (req: Request, res: Response, next: NextFunction) => {
  if (!req.staff?.mfaFresh) return res.status(403).json({ error: 'FRESH_MFA_REQUIRED' });
  next();
};

export const ADMIN_STAFF_ROUTES = [
  ['GET', '/ops/staff', 'staff.read'],
  ['POST', '/ops/staff', 'staff.create'],
  ['PATCH', '/ops/staff/:staffId', 'staff.update'],
  ['POST', '/ops/staff/:staffId/suspend', 'staff.suspend'],
  ['GET', '/ops/cases', 'case.read'],
  ['GET', '/ops/cases/:caseId', 'case.read'],
  ['POST', '/ops/cases/:caseId/assign', 'case.assign'],
  ['POST', '/ops/cases/:caseId/reply', 'case.reply'],
  ['POST', '/ops/cases/:caseId/escalate', 'case.escalate'],
  ['POST', '/ops/cases/:caseId/resolve', 'case.resolve'],
  ['GET', '/ops/clients/:userId/minimum-profile', 'client.profile.read_minimum'],
  ['GET', '/ops/payments/:transferId/trace', 'payments.trace.read'],
  ['GET', '/ops/vault/:userId/quarantine', 'vault.quarantine.review'],
  ['GET', '/ops/audit', 'audit.read'],
  ['POST', '/ops/break-glass/request', 'break_glass.request'],
  ['POST', '/ops/break-glass/:requestId/approve', 'break_glass.approve'],
] as const;

/**
 * IMPORTANT implementation rule:
 * /ops/clients/:userId/minimum-profile must return purpose-scoped fields only.
 * Never return password material, private keys, full card numbers, CVV, TOTP secrets,
 * Vault plaintext, or E2EE message bodies.
 */
