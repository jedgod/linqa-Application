import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { VaultObjectStorage } from "../file-vault.service.js";

/**
 * DEVELOPMENT ONLY. Keeps encrypted vault objects in a folder on this machine so the upload/download flow can be exercised without
 * an S3 bucket and KMS key. It is only ever selected when NODE_ENV is not "production" and no OBJECT_STORAGE_* is configured;
 * production keeps failing closed without real storage.
 *
 * What lands here is ciphertext the phone produced; this server never holds a vault key. Upload and download addresses are short-lived
 * HMAC-signed tokens (the same shape as a presigned URL), so the blob routes need no separate login.
 */

const UPLOAD_TTL_MS = 15 * 60_000;
const DOWNLOAD_TTL_MS = 5 * 60_000;
export const LOCAL_VAULT_DIR = path.resolve(process.cwd(), ".local-vault");

type Claim = { k: string; op: "put" | "get"; exp: number; n?: number };

function sign(secret: string, claim: Claim): string {
  const body = Buffer.from(JSON.stringify(claim)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(secret: string, token: string, op: Claim["op"]): Claim | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claim = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claim;
    return claim.op === op && claim.exp > Date.now() ? claim : null;
  } catch {
    return null;
  }
}

/** Object keys look like vault/<userId>/<itemId>.bin; the path is rebuilt from validated parts, never from raw input. */
function fileFor(key: string): string | null {
  const match = /^vault\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.bin$/.exec(key);
  return match ? path.join(LOCAL_VAULT_DIR, match[1]!, `${match[2]}.bin`) : null;
}

export class LocalVaultObjectStorage implements VaultObjectStorage {
  constructor(private readonly secret: string) {}

  async createUpload(input: { objectKey: string; contentLength: number; contentType: string }) {
    const token = sign(this.secret, { k: input.objectKey, op: "put", exp: Date.now() + UPLOAD_TTL_MS, n: input.contentLength });
    // A path, not a full URL: the phone resolves it against the API address it already uses.
    return { uploadUrl: `/v1/vault/blobs/${token}`, headers: { "Content-Type": "application/octet-stream" } };
  }

  async createDownload(input: { objectKey: string }) {
    return { downloadUrl: `/v1/vault/blobs/${sign(this.secret, { k: input.objectKey, op: "get", exp: Date.now() + DOWNLOAD_TTL_MS })}` };
  }

  async delete(input: { objectKey: string }) {
    const file = fileFor(input.objectKey);
    if (file) await rm(file, { force: true });
  }
}

export async function registerLocalVaultBlobRoutes(app: FastifyInstance, secret: string) {
  await app.register(async (scope) => {
    scope.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: 40 * 1024 * 1024 }, (_request, body, done) => done(null, body));

    scope.put("/v1/vault/blobs/*", async (request, reply) => {
      const claim = verify(secret, (request.params as { "*": string })["*"], "put");
      const file = claim ? fileFor(claim.k) : null;
      const body = request.body;
      if (!claim || !file || !Buffer.isBuffer(body) || (claim.n !== undefined && body.length !== claim.n)) {
        return reply.code(403).send({ error: "invalid_upload" });
      }
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      return reply.code(200).send();
    });

    scope.get("/v1/vault/blobs/*", async (request, reply) => {
      const claim = verify(secret, (request.params as { "*": string })["*"], "get");
      const file = claim ? fileFor(claim.k) : null;
      if (!claim || !file) return reply.code(403).send({ error: "invalid_download" });
      try {
        const data = await readFile(file);
        void reply.header("Cache-Control", "private, no-store");
        return reply.type("application/octet-stream").send(data);
      } catch {
        return reply.code(404).send({ error: "not_found" });
      }
    });
  });
}
