import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  S3Client,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorage } from "../attachment.service.js";

export class S3ObjectStorage implements ObjectStorage {
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

  async health(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
  }

  async createMultipartUpload(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
  }) {
    void input.expiresInSeconds;
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
        ContentType: input.contentType,
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: this.config.kmsKeyId
      })
    );
    if (!result.UploadId) throw new Error("object storage did not return an upload ID");
    return { uploadId: result.UploadId };
  }

  async signPartUpload(input: {
    objectKey: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }) {
    const command = new UploadPartCommand({
      Bucket: this.config.bucket,
      Key: input.objectKey,
      UploadId: input.uploadId,
      PartNumber: input.partNumber
    });
    return {
      url: await getSignedUrl(this.client, command, {
        expiresIn: Math.min(input.expiresInSeconds, 900)
      })
    };
  }

  async completeMultipartUpload(input: {
    objectKey: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }) {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: input.parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag
          }))
        }
      })
    );
  }

  async deleteObject(objectKey: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: objectKey })
    );
  }
}
