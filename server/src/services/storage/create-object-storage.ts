import type { AppConfig } from "../../config.js";
import type { ObjectStorage } from "../attachment.service.js";
import { FailClosedObjectStorage } from "./fail-closed-object-storage.js";
import { S3ObjectStorage } from "./s3-object-storage.js";

/** The one place that decides between real object storage and the fail-closed stand-in, so jobs and the API cannot disagree. */
export function createObjectStorage(config: AppConfig): ObjectStorage {
  return config.OBJECT_STORAGE_REGION && config.OBJECT_STORAGE_BUCKET && config.OBJECT_STORAGE_KMS_KEY_ID
    ? new S3ObjectStorage({
        region: config.OBJECT_STORAGE_REGION,
        bucket: config.OBJECT_STORAGE_BUCKET,
        kmsKeyId: config.OBJECT_STORAGE_KMS_KEY_ID,
        ...(config.OBJECT_STORAGE_ENDPOINT ? { endpoint: config.OBJECT_STORAGE_ENDPOINT } : {}),
        ...(config.OBJECT_STORAGE_FORCE_PATH_STYLE === undefined ? {} : { forcePathStyle: config.OBJECT_STORAGE_FORCE_PATH_STYLE })
      })
    : new FailClosedObjectStorage();
}
