import { beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { GetObjectCommand, ListBucketsCommand, ListMultipartUploadsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { S3ObjectStorage } from "../services/storage/s3-object-storage.js";
import { validateMultipartParts } from "../services/attachment.service.js";

// Runs against a REAL local MinIO, and only when asked: LOCAL_MINIO_ENABLED=true plus OBJECT_STORAGE_ENDPOINT/BUCKET and the scoped
// service-account keys (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY). Development only: it proves the S3 transport and the adapter,
// not production storage, and never touches anything outside its own `integration-tests/` prefix.
// Mirror clients/mobile/services/stream-crypto.ts (5 MiB plaintext chunks, a 16-byte tag each); that file's tests pin the real values.
const STREAM_CHUNK_BYTES = 5 * 1024 * 1024;
const STREAM_TAG_BYTES = 16;

const enabled = process.env.LOCAL_MINIO_ENABLED === "true" && process.env.NODE_ENV !== "production" && Boolean(process.env.OBJECT_STORAGE_ENDPOINT);
const suite = enabled ? describe : describe.skip;

suite("local MinIO: encrypted status-video storage", { timeout: 60_000 }, () => {
  // vitest still runs the body of a skipped suite, so nothing here may be built until the suite is actually enabled.
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT ?? "";
  const bucket = process.env.OBJECT_STORAGE_BUCKET ?? "";
  const region = process.env.OBJECT_STORAGE_REGION ?? "us-east-1";
  let storage!: S3ObjectStorage;
  let s3!: S3Client;
  beforeAll(() => {
    storage = new S3ObjectStorage({ nodeEnv: "development", storageMode: "local-minio", endpoint, bucket, region, forcePathStyle: true });
    s3 = new S3Client({ region, endpoint, forcePathStyle: true });
  });
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

  async function putAll(key: string, uploadId: string, parts: Uint8Array[]) {
    const out: Array<{ partNumber: number; etag: string }> = [];
    for (const [i, bytes] of parts.entries()) {
      const { url } = await storage.signPartUpload({ objectKey: key, uploadId, partNumber: i + 1, expiresInSeconds: 600 });
      const res = await fetch(url, { method: "PUT", body: bytes as unknown as BodyInit });
      expect(res.status).toBe(200);
      const etag = res.headers.get("etag");
      expect(etag).toBeTruthy();
      out.push({ partNumber: i + 1, etag: etag! });
    }
    return out;
  }

  it("the bucket is reachable by the scoped account", async () => {
    await expect(storage.health()).resolves.toBeUndefined();
  });

  it("uploads parts at Linqa's REAL chunk size, completes, downloads byte-identical ciphertext, then deletes (twice, idempotently)", async () => {
    const key = `integration-tests/${randomUUID()}`;
    // The real layout: every sealed chunk is 5 MiB + 16 bytes (>= S3's 5 MiB minimum part), and the last one is smaller.
    const chunks = [randomBytes(STREAM_CHUNK_BYTES + STREAM_TAG_BYTES), randomBytes(STREAM_CHUNK_BYTES + STREAM_TAG_BYTES), randomBytes(1_000_000 + STREAM_TAG_BYTES)];
    const { uploadId } = await storage.createMultipartUpload({ objectKey: key, contentType: "application/octet-stream", expiresInSeconds: 900 });
    let completed = false;
    try {
      const parts = await putAll(key, uploadId, chunks);
      // what MinIO returns is accepted by the server's own validation, so a real upload will not be rejected by it
      expect(() => validateMultipartParts(parts, chunks.length)).not.toThrow();
      await storage.completeMultipartUpload({ objectKey: key, uploadId, parts });
      completed = true;
      expect(await storage.objectExists(key)).toBe(true);

      const { url } = await storage.signDownload({ objectKey: key, expiresInSeconds: 120 });
      const download = await fetch(url);
      expect(download.status).toBe(200);
      const bytes = new Uint8Array(await download.arrayBuffer());
      expect(bytes.length).toBe(chunks.reduce((n, c) => n + c.length, 0));
      expect(sha(bytes)).toBe(sha(Buffer.concat(chunks)));

      const direct = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      expect(direct.ContentLength).toBe(bytes.length);
      // Read the body to the end: an unread GET keeps MinIO's read lock, which would block the delete below.
      expect(sha(await direct.Body!.transformToByteArray())).toBe(sha(bytes));
      // local mode asks for no server-side encryption (a stock MinIO has no KMS); the phone's encryption is what protects the content
      expect(direct.ServerSideEncryption).toBeUndefined();
    } finally {
      if (!completed) await storage.abortMultipartUpload(key, uploadId);
      await storage.deleteObject(key);
    }
    expect(await storage.objectExists(key)).toBe(false);
    await expect(storage.deleteObject(key)).resolves.toBeUndefined();   // deleting what is already gone is not an error
  });

  it("a part smaller than 5 MiB that is not the last is refused by the store, which is why the chunk size matters", async () => {
    const key = `integration-tests/${randomUUID()}`;
    const { uploadId } = await storage.createMultipartUpload({ objectKey: key, contentType: "application/octet-stream", expiresInSeconds: 900 });
    try {
      const parts = await putAll(key, uploadId, [randomBytes(1024 * 1024), randomBytes(1024 * 1024)]);
      await expect(storage.completeMultipartUpload({ objectKey: key, uploadId, parts })).rejects.toThrow();
    } finally {
      await storage.abortMultipartUpload(key, uploadId);
    }
  });

  it("aborting frees the stored parts and is safe to repeat", async () => {
    const key = `integration-tests/${randomUUID()}`;
    const { uploadId } = await storage.createMultipartUpload({ objectKey: key, contentType: "application/octet-stream", expiresInSeconds: 900 });
    await putAll(key, uploadId, [randomBytes(STREAM_CHUNK_BYTES + STREAM_TAG_BYTES)]);
    const open = async () => (await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: key }))).Uploads?.length ?? 0;
    expect(await open()).toBe(1);
    await storage.abortMultipartUpload(key, uploadId);
    expect(await open()).toBe(0);
    await expect(storage.abortMultipartUpload(key, uploadId)).resolves.toBeUndefined();
    expect(await storage.objectExists(key)).toBe(false);
  });

  it("signed links expire, and cannot be reused for another object or without their signature", async () => {
    const key = `integration-tests/${randomUUID()}`;
    const { uploadId } = await storage.createMultipartUpload({ objectKey: key, contentType: "application/octet-stream", expiresInSeconds: 900 });
    const parts = await putAll(key, uploadId, [randomBytes(STREAM_CHUNK_BYTES + STREAM_TAG_BYTES)]);
    await storage.completeMultipartUpload({ objectKey: key, uploadId, parts });
    try {
      const { url } = await storage.signDownload({ objectKey: key, expiresInSeconds: 1 });
      expect((await fetch(url)).status).toBe(200);
      await new Promise((r) => setTimeout(r, 2500));
      expect((await fetch(url)).status).toBe(403);                                                         // expired
      const live = (await storage.signDownload({ objectKey: key, expiresInSeconds: 60 })).url;
      const other = live.replace(encodeURIComponent(key).replace(/%2F/g, "/"), `integration-tests/${randomUUID()}`);
      expect((await fetch(other)).status).toBe(403);                                                       // signature is bound to the key
      expect((await fetch(live.split("?")[0]!)).status).toBe(403);                                         // no signature at all
      // the host is part of what was signed: asking for the same path on another host name is not accepted
      const loopbackAlias = live.replace("127.0.0.1", "localhost");
      expect((await fetch(loopbackAlias)).status).toBe(403);
    } finally {
      await storage.deleteObject(key);
    }
  });

  it("the bucket is private, and the API's account cannot see or touch anything beyond it", async () => {
    const key = `integration-tests/${randomUUID()}`;
    const { uploadId } = await storage.createMultipartUpload({ objectKey: key, contentType: "application/octet-stream", expiresInSeconds: 900 });
    const parts = await putAll(key, uploadId, [randomBytes(STREAM_CHUNK_BYTES + STREAM_TAG_BYTES)]);
    await storage.completeMultipartUpload({ objectKey: key, uploadId, parts });
    try {
      const anonymous = await fetch(`${endpoint}/${bucket}/${key}`);                                       // no credentials at all
      expect(anonymous.status).toBe(403);
      const listing = await fetch(`${endpoint}/${bucket}/?list-type=2`);
      expect(listing.status).toBe(403);
      // MinIO lists only the buckets an account may use, so the scoped account sees exactly one, and nothing next to it.
      expect((await s3.send(new ListBucketsCommand({}))).Buckets?.map((b) => b.Name)).toEqual([bucket]);
      const elsewhere = `${bucket}-other-${randomUUID().slice(0, 8)}`;
      await expect(s3.send(new ListObjectsV2Command({ Bucket: elsewhere }))).rejects.toThrow();
      await expect(s3.send(new PutObjectCommand({ Bucket: elsewhere, Key: "x", Body: "x" }))).rejects.toThrow();
    } finally {
      await storage.deleteObject(key);
    }
  });
});
