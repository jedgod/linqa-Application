import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * One shared "wallpaper settings changed" signal for the whole app. Every chat, the settings screen and the picker read
 * their choices from on-device storage through `useWallpaper`; when any of them saves, this bumps `revision` and all of
 * them re-read at once. So a default picked in Settings shows in a chat that is already open underneath it, with no
 * props to pass down and no stale copies. The choices themselves stay in storage (per account), not in memory here.
 */
interface WallpaperRevision {
  revision: number;
  bump: () => void;
}

const WallpaperContext = createContext<WallpaperRevision | null>(null);

export function WallpaperProvider({ children }: { children: React.ReactNode }) {
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((r) => r + 1), []);
  const value = useMemo(() => ({ revision, bump }), [revision, bump]);
  return <WallpaperContext.Provider value={value}>{children}</WallpaperContext.Provider>;
}

/** `null` outside a provider (isolated previews and tests); `useWallpaper` then falls back to its own counter. */
export const useWallpaperRevision = () => useContext(WallpaperContext);
