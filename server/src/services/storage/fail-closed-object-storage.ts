import type { ObjectStorage } from "../attachment.service.js";

/**
 * No S3-compatible object storage is configured (see APPLY_GUIDE.txt item 5:
 * private bucket, server-side encryption, blocked public access, short-lived
 * signed URLs, lifecycle deletion, checksum verification). This fails closed
 * rather than pretending an upload succeeded.
 */
export class FailClosedObjectStorage implements ObjectStorage {
  async createMultipartUpload(): Promise<{ uploadId: string }> {
    throw new Error("Object storage is not configured.");
  }

  async signPartUpload(): Promise<{ url: string }> {
    throw new Error("Object storage is not configured.");
  }

  async completeMultipartUpload(): Promise<void> {
    throw new Error("Object storage is not configured.");
  }

  async deleteObject(): Promise<void> {
    throw new Error("Object storage is not configured.");
  }
}
