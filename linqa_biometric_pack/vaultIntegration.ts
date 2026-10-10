import type { BiometricStepUpService } from './service';
import type { Principal } from './types';

export class VaultBiometricAuthorization {
  constructor(private bio:BiometricStepUpService){}

  unlockResource(vaultId:string) {
    return {vaultId, action:'UNLOCK_PRIVATE_VAULT'};
  }

  exportResource(objectId:string,destination:string) {
    return {objectId,destination,action:'EXPORT_SOCIAL_COPY'};
  }

  async consumePrivateUnlock(principal:Principal,grantId:string,vaultId:string){
    return this.bio.consumeGrant({principal,grantId,purpose:'VAULT_UNLOCK',resource:this.unlockResource(vaultId)});
  }

  async consumeSocialExport(principal:Principal,grantId:string,objectId:string,destination:string){
    return this.bio.consumeGrant({principal,grantId,purpose:'VAULT_EXPORT_SOCIAL',
      resource:this.exportResource(objectId,destination)});
  }
}
