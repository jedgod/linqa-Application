export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPERVISOR' | 'STAFF' | 'AUDITOR';

export type Permission =
  | 'staff.read' | 'staff.create' | 'staff.update' | 'staff.suspend'
  | 'case.read' | 'case.assign' | 'case.reply' | 'case.escalate' | 'case.resolve'
  | 'client.profile.read_minimum' | 'client.identity.review'
  | 'payments.trace.read' | 'payments.adjustment.request'
  | 'vault.metadata.read' | 'vault.quarantine.review'
  | 'safety.report.review' | 'account.recovery.review'
  | 'audit.read' | 'audit.export' | 'roles.manage' | 'policy.manage'
  | 'break_glass.request' | 'break_glass.approve';

export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  SUPER_ADMIN: ['staff.read','staff.create','staff.update','staff.suspend','case.read','case.assign','case.reply','case.escalate','case.resolve','client.profile.read_minimum','client.identity.review','payments.trace.read','payments.adjustment.request','vault.metadata.read','vault.quarantine.review','safety.report.review','account.recovery.review','audit.read','audit.export','roles.manage','policy.manage','break_glass.request','break_glass.approve'],
  ADMIN: ['staff.read','staff.create','staff.update','staff.suspend','case.read','case.assign','case.reply','case.escalate','case.resolve','client.profile.read_minimum','client.identity.review','payments.trace.read','payments.adjustment.request','vault.metadata.read','vault.quarantine.review','safety.report.review','account.recovery.review','audit.read','audit.export','roles.manage','policy.manage','break_glass.request','break_glass.approve'],
  SUPERVISOR: ['staff.read','case.read','case.assign','case.reply','case.escalate','case.resolve','client.profile.read_minimum','client.identity.review','payments.trace.read','vault.metadata.read','vault.quarantine.review','safety.report.review','account.recovery.review','audit.read','break_glass.request'],
  STAFF: ['case.read','case.reply','case.escalate','case.resolve','client.profile.read_minimum','payments.trace.read','vault.metadata.read','safety.report.review','account.recovery.review','break_glass.request'],
  AUDITOR: ['staff.read','case.read','audit.read','audit.export'],
};
