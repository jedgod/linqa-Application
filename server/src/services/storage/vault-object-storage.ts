import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { VaultObjectStorage } from "../file-vault.service.js";

const UPLOAD_URL_TTL_SECONDS = 900;
const DOWNLOAD_URL_TTL_SECONDS = 300;

export class S3VaultObjectStorage implements VaultObjectStorage {
  private readonly client: S3Client;

  constructor(
    private readonly config: {
      region: string;
      bucket: string;
      kmsKeyId: string;
      endpoint?: string;
      forcePathStyle?: boolean;
    }
  ) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.forcePathStyle === undefined
        ? {}
        : { forcePathStyle: config.forcePathStyle })
    });
  }

  async createUpload(input: {
    objectKey: string;
    contentLength: number;
    contentType: string;
  }) {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: this.config.kmsKeyId
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: UPLOAD_URL_TTL_SECONDS
    });

    return {
      uploadUrl,
      headers: {
        "Content-Type": input.contentType,
        "x-amz-server-side-encryption": "aws:kms",
        "x-amz-server-side-encryption-aws-kms-key-id": this.config.kmsKeyId
      }
    };
  }

  async createDownload(input: { objectKey: string }) {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: input.objectKey
    });

    return {
      downloadUrl: await getSignedUrl(this.client, command, {
        expiresIn: DOWNLOAD_URL_TTL_SECONDS
      })
    };
  }

  async delete(input: { objectKey: string }) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: input.objectKey })
    );
  }
}

/**
 * No S3-compatible object storage is configured. Fails closed rather than
 * pretending a vault upload/download succeeded — same convention as
 * FailClosedObjectStorage for attachments.
 */
export class FailClosedVaultObjectStorage implements VaultObjectStorage {
  async createUpload(): Promise<{ uploadUrl: string; headers: Record<string, string> }> {
    throw new Error("Vault object storage is not configured.");
  }

  async createDownload(): Promise<{ downloadUrl: string }> {
    throw new Error("Vault object storage is not configured.");
  }

  async delete(): Promise<void> {
    throw new Error("Vault object storage is not configured.");
  }
}
