import type { G5SubGate } from "./types.js";

export const G5_REQUIREMENTS: Record<G5SubGate,readonly string[]> = {
  "G5-A":["independent_crypto_review","zero_open_critical","zero_open_high_crypto"],
  "G5-B":["independent_penetration_test","zero_open_critical"],
  "G5-C":["sast","sca","secret_scan","container_scan","iac_scan","sbom","artifact_signature","provenance"],
  "G5-D":["kms_ready","secret_rotation_proven","tls_policy","service_identity","production_network_policy"],
  "G5-E":["backup_restore_proven","rpo_within_target","rto_within_target"],
  "G5-F":["load_test_green","soak_test_green","chaos_suite_green","multi_replica_green"],
  "G5-G":["slos_defined","paging_tested","security_alerts_tested","siem_export_green"],
  "G5-H":["privacy_review_approved","retention_approved","delete_export_tested","incident_response_approved"],
  "G5-I":["ios_release_green","android_release_green","upgrade_green","push_green","web_native_e2e_green"],
  "G5-J":["canary_green","rollback_proven","schema_rollback_compatible"],
  "G5-K":["engineering_approval","security_approval","sre_approval","privacy_legal_approval","product_approval"]
};
