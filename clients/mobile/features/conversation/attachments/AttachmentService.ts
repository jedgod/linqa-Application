// Encrypt -> upload on send, download -> decrypt -> verify on open.
//
// Files never leave the phone unencrypted. Each file gets its own random key;
// that key travels inside the MLS-encrypted FileContent message, so the blob
// server stores bytes it cannot read. Decrypted copies live only in a private
// cache folder that is wiped when the app locks or the user leaves the chat.

import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library/legacy";
import { FileContent, FileKind } from "../content/types";
import { newId } from "../content/codec";
import { validateContent } from "../content/codec";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Authenticated file encryption adapter; the shipped adapter buffers files with a 25 MB limit. */
export interface NativeFileCrypto {
  /** Encrypts inPath -> outPath with a fresh random key. Returns base64 key/nonce and hex sha256 of the plaintext. */
  encryptFile(inPath: string, outPath: string, context?: { blobId: string; mime: string }): Promise<{ key: string; nonce: string; sha256: string; size: number }>;
  /** Decrypts inPath -> outPath. Must reject on authentication failure and leave no partial output. */
  decryptFile(inPath: string, outPath: string, key: string, nonce: string, context?: { blobId: string; mime: string }): Promise<void>;
  sha256File(path: string): Promise<string>;
}

/** Your blob server. It only ever sees ciphertext. */
export interface BlobStore {
  upload(path: string, onProgress?: (fraction: number) => void, blobId?: string): Promise<string>;
  download(blobId: string, outPath: string, onProgress?: (fraction: number) => void): Promise<void>;
}

export class AttachmentError extends Error {
  constructor(
    public code: "TOO_LARGE" | "CRYPTO_UNAVAILABLE" | "INTEGRITY" | "NETWORK" | "NOT_FOUND",
    message: string
  ) {
    super(message);
  }
}

const CACHE_DIR = `${FileSystem.cacheDirectory}linqa-secure/`;
const OUT_DIR = `${CACHE_DIR}out/`;
const OPEN_DIR = `${CACHE_DIR}open/`;

export interface PrepareInput {
  uri: string;
  name: string;
  mime: string;
  kind: FileKind;
  caption?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
  replaces?: string;
  aiPrompt?: string;
}

export class AttachmentService {
  private opened = new Map<string, string>(); // sha256 -> decrypted path
  private generation = 0;
  private readonly openDir = `${OPEN_DIR}${newId()}/`;

  constructor(private crypto: NativeFileCrypto | null, private blobs: BlobStore, private isLive: () => boolean = () => true) {}
  private assertLive(ticket = this.generation) {
    if (!this.isLive() || ticket !== this.generation) throw new AttachmentError("CRYPTO_UNAVAILABLE", "Secure messaging is locked.");
  }

  /** Encrypts and uploads a local file. Returns the content to send through MLS. */
  async prepare(input: PrepareInput, onProgress?: (f: number) => void): Promise<FileContent> {
    const crypto = this.requireCrypto();
    const ticket = this.generation; this.assertLive(ticket);
    const info = await FileSystem.getInfoAsync(input.uri);
    if (!info.exists) throw new AttachmentError("NOT_FOUND", "That file is no longer available.");
    const size = (info as { size?: number }).size;
    if (!Number.isSafeInteger(size) || !size || size > MAX_FILE_BYTES) {
      throw new AttachmentError("TOO_LARGE", "Choose a nonempty file up to 25 MB.");
    }

    await ensureDir(OUT_DIR);
    const id = newId();
    const cipherPath = `${OUT_DIR}${id}.bin`;
    try {
      const sealed = await crypto.encryptFile(input.uri, cipherPath, { blobId: id, mime: input.mime });
      this.assertLive(ticket);
      const content: FileContent = {
        type: "file", fileKind: input.kind, name: sanitizeName(input.name), mime: input.mime || "application/octet-stream", size: sealed.size, blobId: id,
        key: sealed.key, nonce: sealed.nonce, sha256: sealed.sha256, caption: input.caption?.trim() || undefined, width: input.width, height: input.height,
        durationMs: input.durationMs, waveform: input.waveform, replaces: input.replaces, aiPrompt: input.aiPrompt,
      };
      if (!validateContent(content)) throw new AttachmentError("INTEGRITY", "This attachment has invalid details.");
      let blobId: string;
      try {
        blobId = await this.blobs.upload(cipherPath, onProgress, id);
      } catch {
        throw new AttachmentError("NETWORK", "Upload didn't finish. Check your connection and try again.");
      }
      this.assertLive(ticket);
      if (blobId !== id) throw new AttachmentError("INTEGRITY", "Upload identity mismatch.");
      return content;
    } finally {
      await FileSystem.deleteAsync(cipherPath, { idempotent: true });
    }
  }

  /** Downloads, decrypts and verifies a file. Returns a private local path. */
  async open(file: FileContent, onProgress?: (f: number) => void): Promise<string> {
    this.assertLive();
    if (!validateContent(file)) throw new AttachmentError("INTEGRITY", "Invalid attachment.");
    const ticket = this.generation;
    const cacheKey = JSON.stringify([file.blobId, file.key, file.nonce, file.sha256, file.mime, file.size]);
    const cached = this.opened.get(cacheKey);
    if (cached && (await FileSystem.getInfoAsync(cached)).exists) { this.assertLive(ticket); return cached; }

    const crypto = this.requireCrypto();
    await ensureDir(this.openDir);
    const cipherPath = `${this.openDir}${newId()}.bin`;
    const plainPath = `${this.openDir}${newId()}-${sanitizeName(file.name)}`;

    try {
      try {
        await this.blobs.download(file.blobId, cipherPath, onProgress);
      } catch {
        throw new AttachmentError("NETWORK", "Download didn't finish. Check your connection and try again.");
      }
      try {
        this.assertLive(ticket);
        await crypto.decryptFile(cipherPath, plainPath, file.key, file.nonce, { blobId: file.blobId, mime: file.mime });
      } catch {
        throw new AttachmentError("INTEGRITY", "This file was changed or damaged and can't be opened.");
      }
      const digest = await crypto.sha256File(plainPath);
      this.assertLive(ticket);
      const info = await FileSystem.getInfoAsync(plainPath);
      if (!info.exists || (info as { size?: number }).size !== file.size) throw new AttachmentError("INTEGRITY", "File size mismatch.");
      if (digest !== file.sha256) {
        throw new AttachmentError("INTEGRITY", "This file was changed or damaged and can't be opened.");
      }
      this.opened.set(cacheKey, plainPath);
      return plainPath;
    } catch (e) {
      await FileSystem.deleteAsync(plainPath, { idempotent: true });
      throw e;
    } finally {
      await FileSystem.deleteAsync(cipherPath, { idempotent: true });
    }
  }

  /**
   * Saves a decrypted copy outside the app. Only ever called from an explicit
   * "Save" tap: once saved, the copy is no longer protected by Linqa.
   */
  async saveToDevice(file: FileContent): Promise<"photos" | "shared"> {
    const path = await this.open(file);
    this.assertLive();
    if (file.fileKind === "image" || file.fileKind === "video") {
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      this.assertLive();
      if (perm.granted) {
        await MediaLibrary.saveToLibraryAsync(path);
        return "photos";
      }
    }
    // Documents, voice notes, or photos without library permission: system
    // share sheet, which offers "Save to Files" / Downloads.
    this.assertLive();
    if (!await Sharing.isAvailableAsync()) throw new AttachmentError("NOT_FOUND", "Saving is unavailable on this device.");
    this.assertLive();
    await Sharing.shareAsync(path, { mimeType: file.mime, dialogTitle: `Save ${file.name}` });
    return "shared";
  }

  async shareToDevice(file: FileContent): Promise<void> {
    const path = await this.open(file);
    this.assertLive();
    if (!await Sharing.isAvailableAsync()) throw new AttachmentError("NOT_FOUND", "Sharing is unavailable on this device.");
    this.assertLive();
    await Sharing.shareAsync(path, { mimeType: file.mime, dialogTitle: `Open ${file.name}` });
  }

  /** Call on app background/lock and when leaving a conversation. */
  async wipeOpened(): Promise<void> {
    this.generation++;
    this.opened.clear();
    await FileSystem.deleteAsync(this.openDir, { idempotent: true });
  }

  private requireCrypto(): NativeFileCrypto {
    if (!this.crypto) {
      throw new AttachmentError("CRYPTO_UNAVAILABLE", "Files can't be sent or opened on this version of the app yet.");
    }
    return this.crypto;
  }
}

async function ensureDir(dir: string) {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

/** Strip path separators and control characters from names that came from another device. */
export function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return (cleaned || "file").slice(0, 120);
}

export function kindForMime(mime: string): FileKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "voice";
  return "document";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
