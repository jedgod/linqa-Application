export interface MobileReleaseEvidence {
  platform:"ios"|"android";artifactSha256:string;signatureVerified:boolean;releaseBuild:boolean;debugDisabled:boolean;
  secureStoragePassed:boolean;upgradeMigrationPassed:boolean;reinstallRecoveryPassed:boolean;backgroundReceivePassed:boolean;
  pushPassed:boolean;deviceRevocationPassed:boolean;webNativeE2ePassed:boolean;storeValidationPassed:boolean;
}
export function assertMobileRelease(evidence:MobileReleaseEvidence){
  if(!/^[a-f0-9]{64}$/i.test(evidence.artifactSha256))throw new Error(`MOBILE_RELEASE_BLOCKED:${evidence.platform}:artifactSha256`);
  const failures=Object.entries(evidence).filter(([,value])=>typeof value==="boolean"&&!value).map(([key])=>key);
  if(failures.length)throw new Error(`MOBILE_RELEASE_BLOCKED:${evidence.platform}:${failures.join(",")}`);
}
