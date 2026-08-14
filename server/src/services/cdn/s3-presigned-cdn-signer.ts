import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { CdnSigner } from "../attachment-cdn.service.js";

/**
 * Real signed-delivery implementation of CdnSigner (2026-08-07): a presigned
 * S3 GET URL is a legitimate, production-viable "signed CDN URL" — many
 * production deployments put CloudFront/Fastly in front of an S3 origin and
 * either re-sign at the edge or pass a presigned URL straight through. This
 * reuses the same S3Client configuration shape as S3ObjectStorage rather
 * than inventing a second storage abstraction.
 */
export class S3PresignedCdnSigner implements CdnSigner {
  private readonly client: S3Client;

  constructor(private readonly config: { region: string; bucket: string }) {
    this.client = new S3Client({ region: config.region });
  }

  async sign(input: { cdnKey: string; expiresInSeconds: number }): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.config.bucket, Key: input.cdnKey });
    return getSignedUrl(this.client, command, {
      expiresIn: Math.min(Math.max(input.expiresInSeconds, 1), 604_800)
    });
  }
}
