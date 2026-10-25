import {
  STREAM_CHUNK_BYTES, STREAM_TAG_BYTES, MAX_STREAM_CIPHERTEXT_BYTES, StreamCryptoError, chunkCountFor, ciphertextSizeFor,
  encryptChunk, hashChunk, manifestHash, newStreamSecrets, plaintextLengthOf, type StreamParams
} from "./stream-crypto";
import { bytesToBase64 } from "./secure-core";

/**
 * Posts a recorded video to status: encrypt on the phone, upload the ciphertext, seal the key for the chosen people, post.
 *
 * Everything the phone or network touches is injected, so the whole pipeline is tested here without a camera or a server. The
 * order matters:
 *  1. Encrypt the whole recording, chunk by chunk, into a scratch file, keeping each chunk's hash. (The upload API wants the
 *     manifest hash up front, which can only be computed from the finished ciphertext; and a recording is far too big to keep in
 *     memory, so it never is: only one chunk at a time.)
 *  2. Create the upload, then send each chunk as one multipart part, retrying a failed part on its own.
 *  3. Seal the key bundle to every device of every chosen person (and this person's own phone) and create the post. The bundle is
 *     bound to the upload's id, so a server cannot attach it to a different upload.
 * The scratch file is deleted whether this succeeds, fails or is cancelled.
 */

export type StatusVideoPostErrorCode =
  | "EMPTY" | "TOO_LONG" | "TOO_LARGE" | "NO_AUDIENCE" | "CANCELLED" | "STORAGE_FULL" | "UPLOAD_FAILED" | "POST_REJECTED";

export class StatusVideoPostError extends Error {
  constructor(public readonly code: StatusVideoPostErrorCode, public readonly detail?: string) {
    super(code);
    this.name = "StatusVideoPostError";
  }
}

/** The recording on disk. `read` returns exactly `length` bytes starting at `offset`. */
export interface SourceFile { readonly size: number; read(offset: number, length: number): Uint8Array }

/** A private scratch file for the ciphertext. */
export interface ScratchFile {
  append(bytes: Uint8Array): void;
  read(offset: number, length: number): Uint8Array;
  dispose(): void;
}

export interface UploadApi {
  createUpload(input: { ciphertextSize: number; chunkCount: number; manifestHashBase64: string }): Promise<{ attachmentId: string; uploadId: string }>;
  signPart(attachmentId: string, uploadId: string, partNumber: number): Promise<{ url: string }>;
  /** PUT the bytes to the signed URL and return the part's ETag. */
  putPart(url: string, bytes: Uint8Array): Promise<{ etag: string }>;
  complete(attachmentId: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void>;
  createPost(input: {
    attachmentId: string; kind: "VIDEO" | "PODCAST"; durationSeconds: number; ciphertextSize: number; expiresInHours?: number;
    recipients: Array<{ userId: string; deviceId: string; sealedKey: string }>;
  }): Promise<{ id: string; expiresAt: string; deliveredToDevices: number }>;
}

export interface AudienceSealer {
  sealForAudience(plaintext: string, context: { contextId: string; senderUserId: string; clientMessageId: string }, userIds: string[]):
    Promise<Array<{ userId: string; deviceId: string; sealedKey: string }>>;
}

export interface UploadDeps {
  random(n: number): Uint8Array;
  uuid(): string;
  api: UploadApi;
  sealer: AudienceSealer;
  scratch(): ScratchFile;
  sleep?(ms: number): Promise<void>;
}

export interface PostInput {
  source: SourceFile;
  mime: string;
  durationSeconds: number;
  kind: "VIDEO" | "PODCAST";
  ownerUserId: string;
  /** Who may watch. The owner's own devices are always added. */
  audienceUserIds: string[];
  expiresInHours?: number;
}

export type PostPhase = "encrypting" | "uploading" | "sealing" | "posting";
export interface PostProgress { phase: PostPhase; fraction: number }

export const MAX_PODCAST_SECONDS = 30 * 60;
const PART_ATTEMPTS = 3;

/** The sealed text each viewer's device recovers. Never leaves the phone unsealed. */
export interface SealedRecording {
  v: 1;
  mediaId: string;
  ownerUserId: string;
  mime: string;
  chunkSize: number;
  chunkCount: number;
  plaintextSize: number;
  key: string;
  noncePrefix: string;
  durationSeconds: number;
  kind: "VIDEO" | "PODCAST";
}

/** What binds a sealed bundle to one upload, so it cannot be reused for another. */
export const statusVideoContext = (attachmentId: string) => `status-video:${attachmentId}`;

export async function postStatusVideo(
  input: PostInput, deps: UploadDeps, onProgress: (p: PostProgress) => void = () => {}, signal?: { aborted: boolean }
): Promise<{ id: string; expiresAt: string; deliveredToDevices: number }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const check = () => { if (signal?.aborted) throw new StatusVideoPostError("CANCELLED"); };

  if (!(input.source.size > 0)) throw new StatusVideoPostError("EMPTY");
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 1) throw new StatusVideoPostError("EMPTY");
  if (input.durationSeconds > MAX_PODCAST_SECONDS) throw new StatusVideoPostError("TOO_LONG");
  if (input.audienceUserIds.filter((id) => id !== input.ownerUserId).length === 0) throw new StatusVideoPostError("NO_AUDIENCE");
  const plaintextSize = input.source.size;
  const ciphertextSize = ciphertextSizeFor(plaintextSize);
  if (ciphertextSize > MAX_STREAM_CIPHERTEXT_BYTES) throw new StatusVideoPostError("TOO_LARGE");

  const { key, noncePrefix } = newStreamSecrets(deps.random);
  const params: StreamParams = {
    mediaId: deps.uuid(), ownerUserId: input.ownerUserId, mime: input.mime, chunkSize: STREAM_CHUNK_BYTES,
    chunkCount: chunkCountFor(plaintextSize), plaintextSize, key, noncePrefix
  };
  const scratch = deps.scratch();
  try {
    // 1. Encrypt to the scratch file, one chunk in memory at a time.
    const hashes: Uint8Array[] = [];
    for (let i = 0; i < params.chunkCount; i++) {
      check();
      const plain = input.source.read(i * params.chunkSize, plaintextLengthOf(params, i));
      let sealed: Uint8Array;
      try { sealed = encryptChunk(params, i, plain); } finally { plain.fill(0); }
      hashes.push(hashChunk(sealed));
      try { scratch.append(sealed); }
      catch (e) { throw new StatusVideoPostError("STORAGE_FULL", String((e as Error)?.message ?? e)); }
      onProgress({ phase: "encrypting", fraction: (i + 1) / params.chunkCount });
    }

    // 2. Create the upload and send every chunk as one part.
    check();
    let created: { attachmentId: string; uploadId: string };
    try { created = await deps.api.createUpload({ ciphertextSize, chunkCount: params.chunkCount, manifestHashBase64: bytesToBase64(manifestHash(hashes)) }); }
    catch (e) { throw new StatusVideoPostError("UPLOAD_FAILED", `create: ${String((e as Error)?.message ?? e)}`); }
    const parts: Array<{ partNumber: number; etag: string }> = [];
    for (let i = 0; i < params.chunkCount; i++) {
      check();
      const length = plaintextLengthOf(params, i) + STREAM_TAG_BYTES;
      const body = scratch.read(i * (STREAM_CHUNK_BYTES + STREAM_TAG_BYTES), length);
      let etag: string | null = null;
      for (let attempt = 1; attempt <= PART_ATTEMPTS && etag === null; attempt++) {
        try {
          // A signed URL is short-lived and single-purpose, so ask for a fresh one on every attempt.
          const { url } = await deps.api.signPart(created.attachmentId, created.uploadId, i + 1);
          etag = (await deps.api.putPart(url, body)).etag;
        } catch (e) {
          check();
          if (attempt === PART_ATTEMPTS) throw new StatusVideoPostError("UPLOAD_FAILED", `part ${i + 1}: ${String((e as Error)?.message ?? e)}`);
          await sleep(400 * 2 ** (attempt - 1));
        }
      }
      parts.push({ partNumber: i + 1, etag: etag! });
      onProgress({ phase: "uploading", fraction: (i + 1) / params.chunkCount });
    }
    check();
    try { await deps.api.complete(created.attachmentId, created.uploadId, parts); }
    catch (e) { throw new StatusVideoPostError("UPLOAD_FAILED", `complete: ${String((e as Error)?.message ?? e)}`); }

    // 3. Seal the key for the audience, bound to this upload, and post.
    onProgress({ phase: "sealing", fraction: 0 });
    const sealedText: SealedRecording = {
      v: 1, mediaId: params.mediaId, ownerUserId: params.ownerUserId, mime: params.mime, chunkSize: params.chunkSize,
      chunkCount: params.chunkCount, plaintextSize, key: bytesToBase64(key), noncePrefix: bytesToBase64(noncePrefix),
      durationSeconds: input.durationSeconds, kind: input.kind
    };
    const recipients = await deps.sealer.sealForAudience(
      JSON.stringify(sealedText),
      { contextId: statusVideoContext(created.attachmentId), senderUserId: input.ownerUserId, clientMessageId: deps.uuid() },
      input.audienceUserIds.filter((id) => id !== input.ownerUserId)
    );
    check();
    onProgress({ phase: "posting", fraction: 0 });
    try {
      return await deps.api.createPost({
        attachmentId: created.attachmentId, kind: input.kind, durationSeconds: input.durationSeconds, ciphertextSize,
        ...(input.expiresInHours !== undefined ? { expiresInHours: input.expiresInHours } : {}), recipients
      });
    } catch (e) {
      throw new StatusVideoPostError("POST_REJECTED", String((e as Error)?.message ?? e));
    }
  } finally {
    key.fill(0); noncePrefix.fill(0);
    scratch.dispose();
  }
}

export { StreamCryptoError };
