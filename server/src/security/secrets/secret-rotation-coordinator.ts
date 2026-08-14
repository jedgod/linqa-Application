export interface RotatableSecretProvider {currentVersion(name:string):Promise<string>;createNext(name:string):Promise<{version:string}>;validate(name:string,version:string):Promise<boolean>;activate(name:string,version:string):Promise<void>;observedInUse(name:string,version:string):Promise<boolean>;retire(name:string,version:string):Promise<void>}
export class SecretRotationCoordinator {
  constructor(private readonly provider:RotatableSecretProvider){}
  async rotate(name:string){const previousVersion=await this.provider.currentVersion(name);const next=await this.provider.createNext(name);if(next.version===previousVersion||!(await this.provider.validate(name,next.version)))throw new Error(`SECRET_ROTATION_VALIDATION_FAILED:${name}`);await this.provider.activate(name,next.version);return{name,previousVersion,activeVersion:next.version};}
  async retirePrevious(name:string,previousVersion:string,activeVersion:string){if(!(await this.provider.observedInUse(name,activeVersion)))throw new Error(`SECRET_ROTATION_NOT_OBSERVED:${name}`);await this.provider.retire(name,previousVersion);}
}
