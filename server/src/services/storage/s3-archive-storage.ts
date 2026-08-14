import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ArchiveStorage } from "../retention-archive.service.js";

/** Real implementation of ArchiveStorage (2026-08-07): writes newline-delimited JSON to a KMS-encrypted S3 object. */
export class S3ArchiveStorage implements ArchiveStorage {
  private readonly client: S3Client;

  constructor(private readonly config: { region: string; bucket: string; kmsKeyId: string }) {
    this.client = new S3Client({ region: config.region });
  }

  async writeJsonLines(input: { objectKey: string; rows: unknown[] }): Promise<void> {
    const body = input.rows.map((row) => JSON.stringify(row)).join("\n");

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
        Body: body,
        ContentType: "application/x-ndjson",
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: this.config.kmsKeyId
      })
    );
  }
}
