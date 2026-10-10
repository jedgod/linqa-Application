import type { BiometricPurpose } from './types';

export const BIOMETRIC_POLICY: Record<BiometricPurpose,{required:boolean;grantSeconds:number}> = {
  VAULT_UNLOCK:{required:true,grantSeconds:120},
  VAULT_PRIVATE_OPEN:{required:true,grantSeconds:120},
  VAULT_EXPORT_SOCIAL:{required:true,grantSeconds:120},
  VAULT_DELETE_PERMANENT:{required:true,grantSeconds:90},
  VAULT_SHARE_EXTERNAL:{required:true,grantSeconds:120},
  SEND_TRANSFER_AUTHORIZE:{required:true,grantSeconds:90},
  SEND_CASHOUT_AUTHORIZE:{required:true,grantSeconds:90},
  SEND_ADD_PAYMENT_METHOD:{required:true,grantSeconds:90},
  SEND_CHANGE_SECURITY:{required:true,grantSeconds:90},
};
