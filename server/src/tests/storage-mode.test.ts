import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { createObjectStorage } from "../services/storage/create-object-storage.js";
import { FailClosedObjectStorage } from "../services/storage/fail-closed-object-storage.js";
import { S3ObjectStorage } from "../services/storage/s3-object-storage.js";

// What keeps a development convenience from ever weakening a real deployment.

const base = {
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db", JWT_ISSUER: "https://t.local", JWT_AUDIENCE: "linqa-api",
  JWT_HS256_SECRET: "test-secret-that-is-at-least-32-bytes-long", CONTACT_DISCOVERY_SECRET: "test-secret-that-is-at-least-32-bytes-2",
  TOKEN_VAULT_KEY_BASE64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", TURN_SHARED_SECRET: "test-turn-secret-that-is-at-least-32-bytes",
  TURN_URLS: "turn:127.0.0.1:3478?transport=udp", CORS_ORIGINS: "http://127.0.0.1:5173"
};
const minio = { LOCAL_MINIO_ENABLED: "true", OBJECT_STORAGE_REGION: "us-east-1", OBJECT_STORAGE_BUCKET: "linqa-video-dev", OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:19000", OBJECT_STORAGE_FORCE_PATH_STYLE: "true" };
const load = (env: Record<string, string>) => loadConfig({ ...base, ...env } as never);

describe("local MinIO storage mode", () => {
  it("is accepted in development and produces the MinIO adapter", () => {
    const config = load({ NODE_ENV: "development", ...minio });
    expect(createObjectStorage(config)).toBeInstanceOf(S3ObjectStorage);
  });
  it("stops the server at startup anywhere but development", () => {
    for (const NODE_ENV of ["production", "test"]) expect(() => load({ NODE_ENV, ...minio })).toThrow(/LOCAL_MINIO_ENABLED is allowed only when NODE_ENV=development/);
  });
  it("cannot be combined with a KMS key, and needs an endpoint, bucket and region", () => {
    expect(() => load({ NODE_ENV: "development", ...minio, OBJECT_STORAGE_KMS_KEY_ID: "alias/x" })).toThrow(/mutually exclusive/);
    for (const drop of ["OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_REGION"]) {
      const env: Record<string, string> = { NODE_ENV: "development", ...minio }; delete env[drop];
      expect(() => load(env)).toThrow(/requires OBJECT_STORAGE_ENDPOINT/);
    }
  });
  it("rejects anything but the exact strings true or false", () => {
    expect(() => load({ NODE_ENV: "development", ...minio, LOCAL_MINIO_ENABLED: "yes" })).toThrow();
  });
  it("the adapter refuses outside development even if config were bypassed, and refuses a non-local-looking setup", () => {
    const opts = { storageMode: "local-minio" as const, region: "us-east-1", bucket: "b", endpoint: "http://127.0.0.1:19000", forcePathStyle: true };
    expect(() => new S3ObjectStorage({ ...opts, nodeEnv: "production" })).toThrow("LOCAL_MINIO_FORBIDDEN");
    expect(() => new S3ObjectStorage({ ...opts, nodeEnv: "test" })).toThrow("LOCAL_MINIO_FORBIDDEN");
    expect(() => new S3ObjectStorage({ ...opts, nodeEnv: "development", forcePathStyle: false })).toThrow("LOCAL_MINIO_CONFIGURATION_INVALID");
    expect(() => new S3ObjectStorage({ ...opts, nodeEnv: "development", endpoint: "https://s3.amazonaws.com" })).toThrow("LOCAL_MINIO_CONFIGURATION_INVALID");
    expect(() => new S3ObjectStorage({ ...opts, nodeEnv: "development" })).not.toThrow();
  });
});

describe("production storage keeps requiring KMS", () => {
  it("the AWS mode cannot be built without a key", () => {
    expect(() => new S3ObjectStorage({ storageMode: "aws-kms", nodeEnv: "production", region: "us-east-1", bucket: "b" })).toThrow("OBJECT_STORAGE_KMS_REQUIRED");
  });
  it("region and bucket without a KMS key is still a startup error, with the flag off", () => {
    expect(() => load({ NODE_ENV: "production", OBJECT_STORAGE_REGION: "us-east-1", OBJECT_STORAGE_BUCKET: "b" })).toThrow();
    expect(() => load({ NODE_ENV: "development", OBJECT_STORAGE_REGION: "us-east-1", OBJECT_STORAGE_BUCKET: "b" })).toThrow(/OBJECT_STORAGE_/);
  });
  it("with a key it builds the AWS adapter; with nothing configured it fails closed", () => {
    const aws = load({ NODE_ENV: "development", OBJECT_STORAGE_REGION: "us-east-1", OBJECT_STORAGE_BUCKET: "b", OBJECT_STORAGE_KMS_KEY_ID: "alias/x" });
    expect(createObjectStorage(aws)).toBeInstanceOf(S3ObjectStorage);
    expect(createObjectStorage(load({ NODE_ENV: "development" }))).toBeInstanceOf(FailClosedObjectStorage);
  });
});
