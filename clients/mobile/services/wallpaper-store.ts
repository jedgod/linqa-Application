import { isWallpaperId, parseDim } from "./wallpapers";

/**
 * Minimal synchronous key-value storage the wallpaper choices live in. Synchronous on purpose: the first render of a
 * chat already knows its wallpaper, so the background never pops in after the screen appears.
 * SecureStore backs it on the phone (services/wallpaper-prefs.ts); a Map backs it in tests. Anything with sync
 * get/set (such as MMKV) fits behind the same shape.
 */
export interface KeyValueStore {
  get(key: string): string | null;
  /** True only if the value was really stored. */
  set(key: string, value: string): boolean;
  remove(key: string): boolean;
}

// SecureStore keys may only contain letters, digits, ".", "-" and "_".
const safe = (part: string) => part.replace(/[^A-Za-z0-9-]/g, "");

/**
 * Wallpaper choices, kept on this device and scoped to the signed-in account (several accounts can share a phone).
 * `default` is the person's main wallpaper for every chat; a chat entry overrides it for that chat alone; `dim` is how
 * much the wallpaper is darkened behind messages.
 */
export function createWallpaperStore(kv: KeyValueStore) {
  const defaultKey = (userId: string) => `linqa.wallpaper.default.${safe(userId)}`;
  const chatKey = (userId: string, conversationId: string) => `linqa.wallpaper.chat.${safe(userId)}.${safe(conversationId)}`;
  const dimKey = (userId: string) => `linqa.wallpaper.dim.${safe(userId)}`;
  const read = (key: string): string | null => { try { return kv.get(key); } catch { return null; } };
  const readId = (key: string): string | null => { const value = read(key); return isWallpaperId(value) ? value : null; };
  const write = (key: string, value: string | null): boolean => {
    try { return value === null ? kv.remove(key) : kv.set(key, value); } catch { return false; }
  };
  return {
    loadDefault: (userId: string) => readId(defaultKey(userId)),
    saveDefault: (userId: string, id: string | null) => (id === null || isWallpaperId(id) ? write(defaultKey(userId), id) : false),
    loadChat: (userId: string, conversationId: string) => readId(chatKey(userId, conversationId)),
    saveChat: (userId: string, conversationId: string, id: string | null) => (id === null || isWallpaperId(id) ? write(chatKey(userId, conversationId), id) : false),
    loadDim: (userId: string) => parseDim(read(dimKey(userId))),
    saveDim: (userId: string, level: number) => write(dimKey(userId), String(parseDim(level)))
  };
}

export type WallpaperStore = ReturnType<typeof createWallpaperStore>;
