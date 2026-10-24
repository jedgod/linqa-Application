import React, { createContext, useContext, useMemo } from "react";
import type { Theme } from "../../../services/conversation-engine";
import { palette } from "./tokens";

/**
 * The colours the in-thread cards (polls, events, locations, contacts, voice notes, files, live banners) draw with.
 *
 * Those cards used to import one fixed light palette, so they stayed white inside a dark conversation. They now read
 * the palette from here. ConversationScreen provides the thread's current theme; anywhere without a provider falls
 * back to the original light palette, so nothing outside the thread changes.
 */
export type Palette = typeof palette;

const ThreadPaletteContext = createContext<Palette>(palette);

/** Maps the conversation theme onto the card palette (the `night*` entries are for full-screen viewers and stay as they are). */
export function paletteFromTheme(t: Theme): Palette {
  return {
    ...palette,
    bg: t.background,
    surface: t.incoming,
    ink: t.ink,
    muted: t.muted,
    line: t.line,
    outgoing: t.outgoing,
    outgoingInk: t.onOutgoing,
    secure: t.secure,
    secureTint: t.highlight,
    onSecure: t.onAccent,
    onDanger: t.onAccent,
    sealed: t.sealed,
    warn: t.warn,
    warnSurface: t.warnSurface,
    danger: t.danger
  };
}

export function ThreadPaletteProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  const value = useMemo(() => paletteFromTheme(theme), [theme]);
  return <ThreadPaletteContext.Provider value={value}>{children}</ThreadPaletteContext.Provider>;
}

/** The palette plus a StyleSheet built from it. `make` must be a module-level function so the styles are only rebuilt when the theme changes. */
export function useThemed<S>(make: (c: Palette) => S): { c: Palette; styles: S } {
  const c = useContext(ThreadPaletteContext);
  return useMemo(() => ({ c, styles: make(c) }), [c, make]);
}
