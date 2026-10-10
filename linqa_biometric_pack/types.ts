export type BiometricPurpose =
  | 'VAULT_UNLOCK'
  | 'VAULT_PRIVATE_OPEN'
  | 'VAULT_EXPORT_SOCIAL'
  | 'VAULT_DELETE_PERMANENT'
  | 'VAULT_SHARE_EXTERNAL'
  | 'SEND_TRANSFER_AUTHORIZE'
  | 'SEND_CASHOUT_AUTHORIZE'
  | 'SEND_ADD_PAYMENT_METHOD'
  | 'SEND_CHANGE_SECURITY';

export interface Principal {
  userId: string;
  deviceId: string;
  sessionId: string;
}

export interface DeviceTrust {
  trusted: boolean;
  compromised: boolean;
  riskScore: number;
}

export interface RiskEngine {
  assess(input: {
    principal: Principal;
    purpose: BiometricPurpose;
    resource: unknown;
  }): Promise<{ allow: boolean; score: number; reason?: string }>;
}
