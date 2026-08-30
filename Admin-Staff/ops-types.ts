export type StaffRole =
  | 'SUPER_ADMIN' | 'OPS_ADMIN' | 'SUPERVISOR' | 'SUPPORT_AGENT'
  | 'TRUST_SAFETY' | 'FRAUD_ANALYST' | 'FINANCE_OPS' | 'VAULT_OPS'
  | 'RECOVERY_SPECIALIST' | 'AUDITOR' | 'EXECUTIVE_READONLY';

export type CaseType =
  | 'GENERAL_SUPPORT' | 'ACCOUNT_RECOVERY' | 'TRUST_SAFETY' | 'FRAUD_RISK'
  | 'LINQASEND' | 'VAULT_QUARANTINE' | 'CALLS' | 'BILLING' | 'IDENTITY';

export type Severity = 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL';
export type CaseStatus = 'NEW'|'OPEN'|'PENDING_USER'|'PENDING_INTERNAL'|'ESCALATED'|'RESOLVED'|'CLOSED';
export type Presence = 'ONLINE'|'BUSY'|'AWAY'|'OFFLINE';

export interface StaffSession {
  id: string; staffId: string; displayName: string; role: StaffRole;
  presence: Presence; teamId?: string; permissions: string[];
}

export interface SupportCase {
  id: string; type: CaseType; status: CaseStatus; severity: Severity;
  subject: string; clientId: string; assignedStaffId?: string; teamId?: string;
  createdAt: string; updatedAt: string; slaDueAt?: string; tags: string[];
  riskScore?: number; region?: string;
}

export interface Client360 {
  id: string; displayName: string; maskedPhone: string; maskedEmail?: string;
  country?: string; accountState: 'ACTIVE'|'LOCKED'|'RECOVERY'|'SUSPENDED'|'CLOSED';
  riskBand: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL';
  verifiedPhone: boolean; recoveryEmailLinked: boolean; activeDevices: number;
  linqaSendState?: 'ENABLED'|'REVIEW'|'RESTRICTED';
  vaultState?: 'NORMAL'|'QUARANTINE'|'LOCKED';
  openCases: number; lastSupportAt?: string;
}

export interface AuditEvent {
  id: string; actorStaffId: string; action: string; resourceType: string;
  resourceId: string; reasonCode?: string; createdAt: string;
  ipHash?: string; correlationId: string; metadata?: Record<string, unknown>;
}

export interface Incident {
  id: string; title: string; severity: Severity; status: 'INVESTIGATING'|'MITIGATING'|'MONITORING'|'RESOLVED';
  commanderId?: string; startedAt: string; services: string[]; region?: string;
}
