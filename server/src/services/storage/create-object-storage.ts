import type { AppConfig } from "../../config.js";
import type { ObjectStorage } from "../attachment.service.js";
import { FailClosedObjectStorage } from "./fail-closed-object-storage.js";
import { S3ObjectStorage } from "./s3-object-storage.js";

/**
 * The one place that decides between real object storage and the fail-closed stand-in, so jobs and the API cannot disagree.
 *
 * Production storage still requires KMS. The local MinIO mode exists for development only: config validation already refuses it
 * outside NODE_ENV=development, and the adapter refuses again, so a stray flag cannot quietly weaken a real deployment.
 */
export function createObjectStorage(config: AppConfig): ObjectStorage {
  if (config.LOCAL_MINIO_ENABLED === "true") {
    if (config.NODE_ENV !== "development" || !config.OBJECT_STORAGE_ENDPOINT || !config.OBJECT_STORAGE_BUCKET || !config.OBJECT_STORAGE_REGION) {
      throw new Error("LOCAL_MINIO_FORBIDDEN");
    }
    return new S3ObjectStorage({
      nodeEnv: config.NODE_ENV, storageMode: "local-minio", region: config.OBJECT_STORAGE_REGION,
      bucket: config.OBJECT_STORAGE_BUCKET, endpoint: config.OBJECT_STORAGE_ENDPOINT, forcePathStyle: true
    });
  }
  if (config.OBJECT_STORAGE_REGION && config.OBJECT_STORAGE_BUCKET && config.OBJECT_STORAGE_KMS_KEY_ID) {
    return new S3ObjectStorage({
      nodeEnv: config.NODE_ENV, storageMode: "aws-kms", region: config.OBJECT_STORAGE_REGION, bucket: config.OBJECT_STORAGE_BUCKET,
      kmsKeyId: config.OBJECT_STORAGE_KMS_KEY_ID,
      ...(config.OBJECT_STORAGE_ENDPOINT ? { endpoint: config.OBJECT_STORAGE_ENDPOINT } : {}),
      ...(config.OBJECT_STORAGE_FORCE_PATH_STYLE === undefined ? {} : { forcePathStyle: config.OBJECT_STORAGE_FORCE_PATH_STYLE })
    });
  }
  return new FailClosedObjectStorage();
}
