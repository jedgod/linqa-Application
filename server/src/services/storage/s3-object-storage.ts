import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorage } from "../attachment.service.js";

/**
 * Two modes, and the difference is deliberate:
 *  - "aws-kms" (production): every object is written with server-side AWS KMS encryption, and construction fails without a key.
 *  - "local-minio" (development only): no server-side encryption request, because a stock MinIO has no KMS. This is acceptable ONLY
 *    because Linqa encrypts status videos on the phone, so the store never holds anything but ciphertext; it is NOT evidence that
 *    storage meets production requirements, and it refuses to start outside NODE_ENV=development.
 */
export type S3StorageOptions = {
  region: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  kmsKeyId?: string;
  storageMode: "aws-kms" | "local-minio";
  nodeEnv: "development" | "test" | "production";
};

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageOptions) {
    if (config.storageMode === "local-minio") {
      if (config.nodeEnv !== "development") throw new Error("LOCAL_MINIO_FORBIDDEN");
      // Path-style addressing and a plain-HTTP endpoint are how a local MinIO is reached; anything else is a misconfiguration.
      if (!config.endpoint || config.forcePathStyle !== true || !config.endpoint.startsWith("http://")) throw new Error("LOCAL_MINIO_CONFIGURATION_INVALID");
    } else if (!config.kmsKeyId) {
      throw new Error("OBJECT_STORAGE_KMS_REQUIRED");
    }
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.forcePathStyle !== undefined ? { forcePathStyle: config.forcePathStyle } : {})
    });
  }

  async health(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
  }

  async createMultipartUpload(input: { objectKey: string; contentType: string; expiresInSeconds: number }) {
    void input.expiresInSeconds;
    const encryption = this.config.storageMode === "aws-kms"
      ? { ServerSideEncryption: "aws:kms" as const, SSEKMSKeyId: this.config.kmsKeyId! }
      : {};
    const result = await this.client.send(new CreateMultipartUploadCommand({
      Bucket: this.config.bucket, Key: input.objectKey, ContentType: input.contentType, ...encryption
    }));
    if (!result.UploadId) throw new Error("object storage did not return an upload ID");
    return { uploadId: result.UploadId };
  }

  async signPartUpload(input: { objectKey: string; uploadId: string; partNumber: number; expiresInSeconds: number }) {
    return {
      url: await getSignedUrl(
        this.client,
        new UploadPartCommand({ Bucket: this.config.bucket, Key: input.objectKey, UploadId: input.uploadId, PartNumber: input.partNumber }),
        { expiresIn: Math.min(input.expiresInSeconds, 900) }
      )
    };
  }

  async completeMultipartUpload(input: { objectKey: string; uploadId: string; parts: Array<{ partNumber: number; etag: string }> }) {
    const parts = [...input.parts].sort((a, b) => a.partNumber - b.partNumber);
    if (parts.length === 0 || parts.some((part, index) => part.partNumber !== index + 1 || !part.etag)) throw new Error("INVALID_MULTIPART_PARTS");
    await this.client.send(new CompleteMultipartUploadCommand({
      Bucket: this.config.bucket, Key: input.objectKey, UploadId: input.uploadId,
      MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) }
    }));
  }

  async signDownload(input: { objectKey: string; expiresInSeconds: number }) {
    return {
      url: await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.config.bucket, Key: input.objectKey }),
        { expiresIn: Math.min(Math.max(input.expiresInSeconds, 1), 300) }
      )
    };
  }

  /** Idempotent: S3 reports success for an object that is already gone, which is what cleanup needs. */
  async deleteObject(objectKey: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: objectKey }));
  }

  /** Frees the parts of an upload that will never be completed. Safe to repeat; an already-gone upload counts as done. */
  async abortMultipartUpload(objectKey: string, uploadId: string) {
    try {
      await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.config.bucket, Key: objectKey, UploadId: uploadId }));
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchUpload") return;
      throw error;
    }
  }

  async objectExists(objectKey: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: objectKey }));
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (error as { name?: string }).name === "NotFound") return false;
      throw error;
    }
  }
}
