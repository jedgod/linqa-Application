import { base64ToBytes } from "./secure-core";
import { assertMediaSignature } from "./media-validation";
import type { MediaPayload } from "./conversation-engine";
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
export async function readMedia(uri: string, mimeType?: string): Promise<string> {
  const { File } = await import("expo-file-system");
  const file = new File(uri);
  if (!file.exists || file.size <= 0) throw new Error("The recording is empty.");
  if (file.size > MAX_MEDIA_BYTES) throw new Error("Choose a shorter recording or a file under 25 MB.");
  if (mimeType) { const handle = file.open(); try { assertMediaSignature(handle.readBytes(Math.min(32, file.size)), mimeType); } finally { handle.close(); } }
  return file.base64();
}
export async function cacheMedia(id: string, mimeType: string, data: string): Promise<string> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4) throw new Error("Invalid media");
  assertMediaSignature(base64ToBytes(data.slice(0, 64)), mimeType);
  const { File, Paths } = await import("expo-file-system");
  const suffix = mimeType === "image/gif" ? "gif" : mimeType.startsWith("image/") ? "jpg" : mimeType.startsWith("audio/") ? "m4a" : mimeType === "video/quicktime" ? "mov" : "mp4";
  const file = new File(Paths.cache, "linqa-media-" + id + "." + suffix);
  file.create({ overwrite: true });
  file.write(data, { encoding: "base64" });
  return file.uri;
}
export function mediaLabel(p: MediaPayload): string { return p.mediaKind === "VOICE" ? "Voice message" : p.mediaKind === "VIDEO" ? "Video message" : p.mediaKind === "GIF" ? "GIF" : "Photo"; }

const CAPTURE_PREFIX = "linqa-capture-";

/**
 * The camera writes a photo or video into the app's cache folder, and Android deletes cache files on its own when the phone runs low on
 * storage (sometimes within seconds). A capture is therefore copied into the app's permanent storage straight away, and the cache copy
 * is removed; the rest of the flow (check, preview, seal, send) works on the copy.
 */
export async function adoptCapture(uri: string, suffix: "jpg" | "mp4" | "mov" | "m4a"): Promise<string> {
  const { File, Paths } = await import("expo-file-system");
  const source = new File(uri);
  // The camera can hand back the file a moment before it has finished writing it: wait until its size stops changing.
  let size = -1, steady = 0;
  for (let i = 0; i < 30 && steady < 2; i += 1) {
    const now = source.exists ? source.size ?? 0 : 0;
    steady = now > 0 && now === size ? steady + 1 : 0;
    size = now;
    if (steady < 2) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!source.exists || size <= 0) throw new Error("The capture was not saved (source " + (source.exists ? "empty" : "missing") + "). Try again.");
  const target = new File(Paths.document, CAPTURE_PREFIX + Date.now() + "-" + Math.random().toString(16).slice(2) + "." + suffix);
  // File.move/copy reported success on some phones while leaving 0 bytes, so the bytes are read and written explicitly (the path
  // received media already uses); the cache original is removed only after the copy checks out.
  const data = await source.base64();
  target.create({ overwrite: true });
  target.write(data, { encoding: "base64" });
  const kept = new File(target.uri);
  if (kept.exists && (kept.size ?? 0) === size) { try { source.delete(); } catch {} }
  const saved = kept.exists ? kept.size ?? 0 : 0;
  if (saved <= 0 || saved !== size) {
    // Diagnostic detail: where the file ended up according to the file system.
    const tail = (u: string) => u.slice(-34);
    const detail = "doc=" + tail(Paths.document.uri) + " tgt=" + tail(target.uri) + (target.exists ? "+" : "-") + " src=" + tail(source.uri) + (source.exists ? "+" : "-");
    try { if (kept.exists) kept.delete(); } catch {}
    throw new Error("The capture was not saved (kept " + saved + " of " + size + " bytes; " + detail + "). Try again.");
  }
  return kept.uri;
}

export async function discardLocalMedia(uri: string): Promise<void> {
  const { File, Paths } = await import("expo-file-system");
  const documentUri = Paths.document.uri.endsWith("/") ? Paths.document.uri : Paths.document.uri + "/";
  if (uri.startsWith(documentUri + CAPTURE_PREFIX)) { try { const own = new File(uri); if (own.exists) own.delete(); } catch {} return; }
  if (!uri.startsWith(Paths.cache.uri + "/") && !uri.startsWith(Paths.cache.uri.endsWith("/") ? Paths.cache.uri : Paths.cache.uri + "/")) return;
  try { const file = new File(uri); if (file.exists) file.delete(); } catch {}
}
