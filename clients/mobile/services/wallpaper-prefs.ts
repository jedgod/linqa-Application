import * as SecureStore from "expo-secure-store";
import { createWallpaperStore } from "./wallpaper-store";

/**
 * On-device wallpaper choices, stored the same way as the other conversation preferences. The synchronous SecureStore
 * calls keep the first paint correct. SecureStore has no synchronous delete, so "unset" is stored as an empty value,
 * which reads back as no choice.
 */
export const wallpaperStore = createWallpaperStore({
  get: (key) => SecureStore.getItem(key),
  set: (key, value) => { SecureStore.setItem(key, value); return true; },
  remove: (key) => { SecureStore.setItem(key, ""); return true; }
});
