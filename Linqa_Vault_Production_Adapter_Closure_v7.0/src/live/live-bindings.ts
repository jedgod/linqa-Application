import type * as C from '../contracts.js';

/**
 * Map these to EXISTING Linqa services. Do not create parallel identity/device authorities.
 * DeviceTrust should delegate to Device Link v2 (linked device status + attestation).
 */
export type LiveLinqaBindings={
 principal:C.PrincipalAdapter;
 deviceTrust:C.DeviceTrustAdapter;
 twoFactor:C.TwoFactorAdapter;
 loginAlerts:C.LoginAlertAdapter;
 social:C.AttachmentSourceAdapter;
 messages:C.AttachmentSourceAdapter;
 business:C.BusinessSourceAdapter;
 objectStore:C.ObjectStore;
 malware:C.MalwareScanner;
 dlp:C.DlpScanner;
 mail:C.MailAdapter;
 billing:C.BillingAdapter;
 socialExport:C.SocialExportAdapter;
 vaultCiphertext:C.VaultCiphertextAdapter;
};
export function assertBindings(x:Partial<LiveLinqaBindings>):asserts x is LiveLinqaBindings{
 const required=(['principal','deviceTrust','twoFactor','loginAlerts','social','messages','business','objectStore','malware','dlp','mail','billing','socialExport','vaultCiphertext'] as const);
 const missing=required.filter(k=>!x[k]);
 if(missing.length) throw new Error(`VAULT_LIVE_BINDINGS_MISSING:${missing.join(',')}`);
}
