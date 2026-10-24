import { useCallback, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { resolveWallpaper, type Wallpaper } from "../../services/wallpapers";
import { wallpaperStore } from "../../services/wallpaper-prefs";
import { useWallpaperRevision } from "./WallpaperContext";

export interface WallpaperState {
  /** The wallpaper in effect here: this chat's own, else the person's default, else the one matching the phone's appearance. */
  wallpaper: Wallpaper;
  /** False only while nothing is chosen anywhere and the wallpaper is following the phone's light/dark appearance. */
  explicit: boolean;
  /** How much the wallpaper is darkened behind messages, 0 to 0.6. */
  dim: number;
  /** The person's main wallpaper, or null if they never set one (then it matches the phone's appearance). */
  defaultId: string | null;
  /** This chat's own wallpaper, or null if it follows the default. */
  chatId: string | null;
  /** Return true only if the choice was really saved. */
  setDefault: (id: string | null) => boolean;
  setForChat: (id: string | null) => boolean;
  setDim: (level: number) => boolean;
}

/**
 * This account's wallpaper choices for one chat. Reads are synchronous, so the very first render already shows the
 * saved wallpaper (no flash of another one first). Any save, from any screen, re-reads everywhere through the shared
 * WallpaperProvider, and a change to the phone's light/dark setting is followed live while nothing is chosen.
 */
export function useWallpaper(userId: string, conversationId: string | undefined): WallpaperState {
  const shared = useWallpaperRevision();
  const [localRevision, setLocalRevision] = useState(0);
  const revision = shared ? shared.revision : localRevision;
  const systemScheme = useColorScheme();

  const saved = useMemo(
    () => ({
      defaultId: userId ? wallpaperStore.loadDefault(userId) : null,
      chatId: userId && conversationId ? wallpaperStore.loadChat(userId, conversationId) : null,
      dim: userId ? wallpaperStore.loadDim(userId) : 0
    }),
    // `revision` is the re-read trigger after a save anywhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, conversationId, revision]
  );

  const commit = useCallback((ok: boolean) => {
    if (ok) { if (shared) shared.bump(); else setLocalRevision((r) => r + 1); }
    return ok;
  }, [shared]);
  const setDefault = useCallback((id: string | null) => commit(Boolean(userId) && wallpaperStore.saveDefault(userId, id)), [userId, commit]);
  const setForChat = useCallback((id: string | null) => commit(Boolean(userId && conversationId) && wallpaperStore.saveChat(userId, conversationId!, id)), [userId, conversationId, commit]);
  const setDim = useCallback((level: number) => commit(Boolean(userId) && wallpaperStore.saveDim(userId, level)), [userId, commit]);

  const resolved = useMemo(() => resolveWallpaper(saved.chatId, saved.defaultId, systemScheme), [saved.chatId, saved.defaultId, systemScheme]);
  return { ...resolved, dim: saved.dim, defaultId: saved.defaultId, chatId: saved.chatId, setDefault, setForChat, setDim };
}
