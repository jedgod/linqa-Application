import {
  STREAM_CHUNK_BYTES, STREAM_TAG_BYTES, StreamCryptoError, assertParams, ciphertextSizeFor, decryptChunk, plaintextLengthOf, type StreamParams
} from "./stream-crypto";
import { base64ToBytes } from "./secure-core";
import { statusVideoContext, type SealedRecording } from "./status-video-upload";

/**
 * Watching a status video: open the sealed key bundle, download the ciphertext, and decrypt it chunk by chunk into a private file.
 *
 * Nothing is trusted from the server beyond "here are some bytes": the key, layout, MIME type and sender come from the sealed
 * bundle (which only this device can open and which names the upload it was made for), the expected size is recomputed from it,
 * and every chunk must authenticate against its own position. Any failure deletes the partly written plaintext.
 */

export interface FeedItem {
  id: string;
  attachmentId: string;
  ownerUserId: string;
  kind: "VIDEO" | "PODCAST";
  durationSeconds: number;
  ciphertextSize: number;
  createdAt: string;
  expiresAt: string;
  sealedKey: string;
  viewedAt: string | null;
}

export type StatusVideoViewErrorCode = "BUNDLE_INVALID" | "SIZE_MISMATCH" | "DOWNLOAD_FAILED" | "CORRUPT" | "STORAGE_FULL" | "CANCELLED";
export class StatusVideoViewError extends Error {
  constructor(public readonly code: StatusVideoViewErrorCode, public readonly detail?: string) {
    super(code);
    this.name = "StatusVideoViewError";
  }
}

export interface CipherFile { readonly size: number; read(offset: number, length: number): Uint8Array; dispose(): void }
export interface PlainSink { append(bytes: Uint8Array): void; /** Final location, once everything is written. */ finish(): string; dispose(): void }

export interface ViewDeps {
  /** `SecureCoreMessaging.open`: opens a bundle sealed for this device. */
  open(sealedKey: string, context: { conversationId: string; senderUserId: string; messageId: string }): Promise<string>;
  api: {
    download(postId: string): Promise<{ url: string; ciphertextSize: number }>;
    markViewed(postId: string): Promise<void>;
  };
  /** Download the ciphertext at `url` to a private file and return a reader over it. */
  fetchCipher(url: string, expectedSize: number): Promise<CipherFile>;
  plainSink(mime: string): PlainSink;
}

export interface OpenedRecording {
  uri: string;
  mime: string;
  durationSeconds: number;
  kind: "VIDEO" | "PODCAST";
}

/** Recovers and validates the recording description from a sealed bundle. Exported so the checks can be tested on their own. */
export async function openSealedRecording(item: FeedItem, open: ViewDeps["open"]): Promise<{ params: StreamParams; durationSeconds: number; kind: "VIDEO" | "PODCAST" }> {
  let text: string;
  try {
    text = await open(item.sealedKey, { conversationId: statusVideoContext(item.attachmentId), senderUserId: item.ownerUserId, messageId: item.id });
  } catch {
    throw new StatusVideoViewError("BUNDLE_INVALID");
  }
  let s: SealedRecording;
  try { s = JSON.parse(text) as SealedRecording; } catch { throw new StatusVideoViewError("BUNDLE_INVALID"); }
  if (!s || s.v !== 1 || s.ownerUserId !== item.ownerUserId || typeof s.key !== "string" || typeof s.noncePrefix !== "string") throw new StatusVideoViewError("BUNDLE_INVALID");
  if (s.kind !== "VIDEO" && s.kind !== "PODCAST") throw new StatusVideoViewError("BUNDLE_INVALID");
  let params: StreamParams;
  try {
    params = { mediaId: s.mediaId, ownerUserId: s.ownerUserId, mime: s.mime, chunkSize: s.chunkSize, chunkCount: s.chunkCount, plaintextSize: s.plaintextSize, key: base64ToBytes(s.key), noncePrefix: base64ToBytes(s.noncePrefix) };
    assertParams(params);
  } catch {
    throw new StatusVideoViewError("BUNDLE_INVALID");
  }
  // The server's own idea of the size must agree with the sealed layout, or the bytes are not this recording.
  if (ciphertextSizeFor(params.plaintextSize, params.chunkSize) !== item.ciphertextSize) throw new StatusVideoViewError("SIZE_MISMATCH");
  if (!Number.isInteger(s.durationSeconds) || s.durationSeconds < 1) throw new StatusVideoViewError("BUNDLE_INVALID");
  return { params, durationSeconds: s.durationSeconds, kind: s.kind };
}

export async function openStatusVideo(item: FeedItem, deps: ViewDeps, signal?: { aborted: boolean }): Promise<OpenedRecording> {
  const { params, durationSeconds, kind } = await openSealedRecording(item, deps.open);
  const expected = ciphertextSizeFor(params.plaintextSize, params.chunkSize);
  let cipher: CipherFile | null = null;
  let sink: PlainSink | null = null;
  try {
    let link: { url: string; ciphertextSize: number };
    try { link = await deps.api.download(item.id); } catch (e) { throw new StatusVideoViewError("DOWNLOAD_FAILED", String((e as Error)?.message ?? e)); }
    if (link.ciphertextSize !== expected) throw new StatusVideoViewError("SIZE_MISMATCH");
    try { cipher = await deps.fetchCipher(link.url, expected); } catch (e) { throw new StatusVideoViewError("DOWNLOAD_FAILED", String((e as Error)?.message ?? e)); }
    if (cipher.size !== expected) throw new StatusVideoViewError("SIZE_MISMATCH");

    sink = deps.plainSink(params.mime);
    for (let i = 0; i < params.chunkCount; i++) {
      if (signal?.aborted) throw new StatusVideoViewError("CANCELLED");
      const sealed = cipher.read(i * (STREAM_CHUNK_BYTES + STREAM_TAG_BYTES), plaintextLengthOf(params, i) + STREAM_TAG_BYTES);
      let plain: Uint8Array;
      try { plain = decryptChunk(params, i, sealed); }
      catch (e) { throw new StatusVideoViewError("CORRUPT", e instanceof StreamCryptoError ? e.code : undefined); }
      try { sink.append(plain); }
      catch (e) { throw new StatusVideoViewError("STORAGE_FULL", String((e as Error)?.message ?? e)); }
      finally { plain.fill(0); }
    }
    const uri = sink.finish();
    sink = null; // ownership passes to the caller, who deletes it when the viewer closes
    void deps.api.markViewed(item.id).catch(() => undefined);
    return { uri, mime: params.mime, durationSeconds, kind };
  } finally {
    params.key.fill(0); params.noncePrefix.fill(0);
    cipher?.dispose();
    sink?.dispose();
  }
}
