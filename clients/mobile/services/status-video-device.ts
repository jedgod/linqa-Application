import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { getApiBaseUrl } from "../config/api";
import { accessTokenProvider } from "./session";
import { sharedSecureSession } from "./shared-secure-session";
import type { CipherFile, FeedItem, PlainSink, ViewDeps } from "./status-video-view";
import type { ScratchFile, SourceFile, UploadApi, UploadDeps } from "./status-video-upload";

/**
 * The phone-specific parts of status video: real files, real HTTP, the account's secure session. The logic that matters (encrypt,
 * upload, seal, verify, decrypt) lives in status-video-upload.ts and status-video-view.ts and is tested without a device; this file
 * only moves bytes. Nothing here is unit-tested, so it is kept deliberately thin.
 *
 * Everything written to disk goes under a private folder, is created per use, and is deleted by its owner when done. It lives in the
 * app's files folder, not the cache folder: Android empties the cache within seconds when the phone is nearly full, which deleted the
 * scratch file in the middle of an upload. The app does not allow backups, so these files are never copied off the phone.
 * Ciphertext scratch files are always deleted; decrypted copies are deleted when the viewer closes (see `wipeOpenedVideos`).
 */

const root = () => { const d = new Directory(Paths.document, "linqa-secure"); if (!d.exists) d.create({ intermediates: true }); return d; };
const sub = (name: string) => { const d = new Directory(root(), name); if (!d.exists) d.create({ intermediates: true }); return d; };
const randomName = (ext: string) => `${Crypto.randomUUID()}.${ext}`;

/** A recording on disk, read one slice at a time. */
export function fileSource(uri: string): SourceFile {
  const file = new File(uri);
  const size = file.size;
  return {
    size,
    read(offset, length) {
      const h = file.open(FileMode.ReadOnly);
      try { h.offset = offset; const bytes = h.readBytes(length); if (bytes.length !== length) throw new Error("SHORT_READ"); return bytes; }
      finally { h.close(); }
    }
  };
}

/** Ciphertext scratch space; the whole recording's ciphertext sits here between encrypting and uploading. */
export function scratchFile(): ScratchFile {
  const file = new File(sub("upload"), randomName("bin"));
  file.create();
  let writer: ReturnType<File["open"]> | null = null;
  return {
    append(bytes) { writer ??= file.open(FileMode.Append); writer.writeBytes(bytes); },
    read(offset, length) {
      writer?.close(); writer = null; // reads happen after all writes; make sure the data is on disk
      const h = file.open(FileMode.ReadOnly);
      try { h.offset = offset; return h.readBytes(length); } finally { h.close(); }
    },
    dispose() { try { writer?.close(); } catch { /* already closed */ } writer = null; try { if (file.exists) file.delete(); } catch { /* nothing more to do */ } }
  };
}

/** Where a decrypted video is written for the player. */
export function plainSink(mime: string): PlainSink {
  const ext = mime.includes("quicktime") ? "mov" : mime.includes("webm") ? "webm" : "mp4";
  const file = new File(sub("open"), randomName(ext));
  file.create();
  let writer: ReturnType<File["open"]> | null = null;
  return {
    append(bytes) { writer ??= file.open(FileMode.Append); writer.writeBytes(bytes); },
    finish() { writer?.close(); writer = null; return file.uri; },
    dispose() { try { writer?.close(); } catch { /* already closed */ } writer = null; try { if (file.exists) file.delete(); } catch { /* nothing more to do */ } }
  };
}

/** Remove every decrypted copy left on disk (viewer closed, app locked, account switched). */
/** Removes ciphertext and decrypted files that a killed or crashed run left behind. Call it before starting any new work. */
export function sweepSecureScratch(): void {
  for (const name of ["upload", "download", "open"]) {
    try { const d = new Directory(root(), name); if (d.exists) d.delete(); } catch { /* best effort */ }
  }
}

export function wipeOpenedVideos(): void {
  try { const d = new Directory(root(), "open"); if (d.exists) d.delete(); } catch { /* best effort */ }
}

export async function fetchCipher(url: string, expectedSize: number): Promise<CipherFile> {
  const file = new File(sub("download"), randomName("bin"));
  await File.downloadFileAsync(url, file, { idempotent: true });
  const size = file.size;
  void expectedSize; // compared by the caller, which owns the error to raise
  return {
    size,
    read(offset, length) {
      const h = file.open(FileMode.ReadOnly);
      try { h.offset = offset; return h.readBytes(length); } finally { h.close(); }
    },
    dispose() { try { if (file.exists) file.delete(); } catch { /* nothing more to do */ } }
  };
}

export class StatusVideoApi implements UploadApi {
  constructor(private readonly baseUrl: string = getApiBaseUrl(), private readonly token: () => Promise<string> = () => accessTokenProvider.getAccessToken()) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.token()}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : `HTTP_${response.status}`);
    return data as T;
  }

  createUpload(input: { ciphertextSize: number; chunkCount: number; manifestHashBase64: string }) {
    // `purpose` marks this upload as a status video, which is what lets the server clean it up if it is never posted.
    return this.call<{ attachmentId: string; uploadId: string }>("POST", "/v1/attachments", { mediaType: "VIDEO", purpose: "STATUS_VIDEO", ...input });
  }
  async abort(attachmentId: string) { await this.call("POST", `/v1/attachments/${attachmentId}/abort`, {}); }
  signPart(attachmentId: string, uploadId: string, partNumber: number) {
    return this.call<{ url: string }>("POST", `/v1/attachments/${attachmentId}/parts/${partNumber}`, { uploadId });
  }
  async putPart(url: string, bytes: Uint8Array) {
    const response = await fetch(url, { method: "PUT", body: bytes as unknown as BodyInit });
    if (!response.ok) throw new Error(`PART_HTTP_${response.status}`);
    const etag = response.headers.get("etag");
    if (!etag) throw new Error("PART_NO_ETAG");
    return { etag };
  }
  async complete(attachmentId: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>) {
    await this.call("POST", `/v1/attachments/${attachmentId}/complete`, { uploadId, parts });
  }
  createPost(input: Parameters<UploadApi["createPost"]>[0]) { return this.call<Awaited<ReturnType<UploadApi["createPost"]>>>("POST", "/v1/status-videos", input); }

  async feed(): Promise<FeedItem[]> { return (await this.call<{ items: FeedItem[] }>("GET", "/v1/status-videos/feed")).items; }
  mine() { return this.call<{ items: Array<{ id: string; kind: string; durationSeconds: number; createdAt: string; expiresAt: string; deliveredToDevices: number; viewedByDevices: number }> }>("GET", "/v1/status-videos/mine"); }
  download(postId: string) {
    return this.call<{ url: string; ciphertextSize: number }>("POST", `/v1/status-videos/${postId}/download`);
  }
  async markViewed(postId: string) { await this.call("POST", `/v1/status-videos/${postId}/viewed`); }
  async remove(postId: string) { await this.call("DELETE", `/v1/status-videos/${postId}`); }
}

/** Everything the uploader needs for the signed-in account, or null when secure messaging is not available on this phone. */
export function uploadDepsFor(selfId: string): UploadDeps | null {
  const session = sharedSecureSession(selfId);
  if (!session) return null;
  return {
    random: (n) => Crypto.getRandomBytes(n),
    uuid: () => Crypto.randomUUID(),
    api: new StatusVideoApi(),
    sealer: session.messaging,
    scratch: scratchFile
  };
}

export function viewDepsFor(selfId: string): ViewDeps | null {
  const session = sharedSecureSession(selfId);
  if (!session) return null;
  const api = new StatusVideoApi();
  return { open: (sealed, ctx) => session.messaging.open(sealed, ctx), api, fetchCipher, plainSink };
}
