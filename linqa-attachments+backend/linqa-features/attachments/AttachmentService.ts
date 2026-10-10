// Encrypt -> upload on send, download -> decrypt -> verify on open.
//
// Files never leave the phone unencrypted. Each file gets its own random key;
// that key travels inside the MLS-encrypted FileContent message, so the blob
// server stores bytes it cannot read. Decrypted copies live only in a private
// cache folder that is wiped when the app locks or the user leaves the chat.

import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";
import { FileContent, FileKind } from "../content/types";
import { newId } from "../content/codec";

export const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** Implemented in linqa-core (Rust) and exposed through the same native module as MessageCrypto. */
export interface NativeFileCrypto {
  /** Streams inPath -> outPath with a fresh random key. Returns base64 key/nonce and hex sha256 of the plaintext. */
  encryptFile(inPath: string, outPath: string): Promise<{ key: string; nonce: string; sha256: string; size: number }>;
  /** Streams inPath -> outPath. Must reject on authentication failure and leave no partial output. */
  decryptFile(inPath: string, outPath: string, key: string, nonce: string): Promise<void>;
  sha256File(path: string): Promise<string>;
}

/** Your blob server. It only ever sees ciphertext. */
export interface BlobStore {
  upload(path: string, onProgress?: (fraction: number) => void): Promise<string>; // returns blobId
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

  constructor(private crypto: NativeFileCrypto | null, private blobs: BlobStore) {}

  /** Encrypts and uploads a local file. Returns the content to send through MLS. */
  async prepare(input: PrepareInput, onProgress?: (f: number) => void): Promise<FileContent> {
    const crypto = this.requireCrypto();
    const info = await FileSystem.getInfoAsync(input.uri);
    if (!info.exists) throw new AttachmentError("NOT_FOUND", "That file is no longer available.");
    if ((info as { size?: number }).size! > MAX_FILE_BYTES) {
      throw new AttachmentError("TOO_LARGE", "Files can be up to 100 MB.");
    }

    await ensureDir(OUT_DIR);
    const cipherPath = `${OUT_DIR}${newId()}.bin`;
    try {
      const sealed = await crypto.encryptFile(input.uri, cipherPath);
      let blobId: string;
      try {
        blobId = await this.blobs.upload(cipherPath, onProgress);
      } catch {
        throw new AttachmentError("NETWORK", "Upload didn't finish. Check your connection and try again.");
      }
      return {
        type: "file",
        fileKind: input.kind,
        name: sanitizeName(input.name),
        mime: input.mime || "application/octet-stream",
        size: sealed.size,
        blobId,
        key: sealed.key,
        nonce: sealed.nonce,
        sha256: sealed.sha256,
        caption: input.caption?.trim() || undefined,
        width: input.width,
        height: input.height,
        durationMs: input.durationMs,
        waveform: input.waveform,
        replaces: input.replaces,
        aiPrompt: input.aiPrompt,
      };
    } finally {
      await FileSystem.deleteAsync(cipherPath, { idempotent: true });
    }
  }

  /** Downloads, decrypts and verifies a file. Returns a private local path. */
  async open(file: FileContent, onProgress?: (f: number) => void): Promise<string> {
    const cached = this.opened.get(file.sha256);
    if (cached && (await FileSystem.getInfoAsync(cached)).exists) return cached;

    const crypto = this.requireCrypto();
    await ensureDir(OPEN_DIR);
    const cipherPath = `${OPEN_DIR}${newId()}.bin`;
    const plainPath = `${OPEN_DIR}${newId()}-${sanitizeName(file.name)}`;

    try {
      try {
        await this.blobs.download(file.blobId, cipherPath, onProgress);
      } catch {
        throw new AttachmentError("NETWORK", "Download didn't finish. Check your connection and try again.");
      }
      try {
        await crypto.decryptFile(cipherPath, plainPath, file.key, file.nonce);
      } catch {
        throw new AttachmentError("INTEGRITY", "This file was changed or damaged and can't be opened.");
      }
      const digest = await crypto.sha256File(plainPath);
      if (digest !== file.sha256) {
        throw new AttachmentError("INTEGRITY", "This file was changed or damaged and can't be opened.");
      }
      this.opened.set(file.sha256, plainPath);
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
    if (file.fileKind === "image" || file.fileKind === "video") {
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (perm.granted) {
        await MediaLibrary.saveToLibraryAsync(path);
        return "photos";
      }
    }
    // Documents, voice notes, or photos without library permission: system
    // share sheet, which offers "Save to Files" / Downloads.
    await Sharing.shareAsync(path, { mimeType: file.mime, dialogTitle: `Save ${file.name}` });
    return "shared";
  }

  /** Call on app background/lock and when leaving a conversation. */
  async wipeOpened(): Promise<void> {
    this.opened.clear();
    await FileSystem.deleteAsync(OPEN_DIR, { idempotent: true });
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
