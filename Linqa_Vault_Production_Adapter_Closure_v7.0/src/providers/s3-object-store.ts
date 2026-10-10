/**
 * Reference implementation contract. Install @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner.
 * Keep quarantine and ciphertext buckets separate. IAM:
 * - intake worker: quarantine read/write only
 * - scan worker: quarantine read only (+ scanner integration)
 * - vault object service: ciphertext bucket only
 * - social service: NO bucket access
 */
export const S3_IAM_INVARIANT='SOCIAL_HAS_NO_VAULT_OR_QUARANTINE_BUCKET_ACCESS';
