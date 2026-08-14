export interface ProductionAdmissionInput {
  environment:"staging"|"production";artifactSignatureVerified:boolean;sbomVerified:boolean;provenanceVerified:boolean;
  migrationDirty:boolean;backupRestoreVerified:boolean;g0ToG4Verified:boolean;g5Verified:boolean;
}
export function assertDeploymentAdmitted(input:ProductionAdmissionInput){
  if(input.environment!=="production")return;const failures:string[]=[];
  if(!input.artifactSignatureVerified)failures.push("ARTIFACT_SIGNATURE_INVALID");if(!input.sbomVerified)failures.push("SBOM_INVALID");if(!input.provenanceVerified)failures.push("PROVENANCE_INVALID");
  if(input.migrationDirty)failures.push("MIGRATION_DIRTY");if(!input.backupRestoreVerified)failures.push("BACKUP_RESTORE_NOT_PROVEN");if(!input.g0ToG4Verified)failures.push("G0_G4_NOT_GREEN");if(!input.g5Verified)failures.push("G5_NOT_GREEN");
  if(failures.length)throw new Error(`PRODUCTION_ADMISSION_DENIED:${failures.join(",")}`);
}
