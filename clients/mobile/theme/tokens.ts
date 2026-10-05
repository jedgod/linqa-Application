import { useColorScheme } from "react-native";

/**
 * Shared design tokens. Extracted from the colors/radii already duplicated
 * across every auth/account screen (see git history pre-2026-08-09) rather
 * than introduced from scratch, so this is a consolidation, not a rebrand.
 */
export { darkColors, lightColors, type Palette } from "./palettes";
import { darkColors, lightColors, type Palette } from "./palettes";

/** Static dark palette. Prefer useTheme() so screens follow the system setting. */
export const colors = darkColors;

/** Palette for the current system appearance (light unless the OS is in dark mode). */
export function useTheme(): { colors: Palette; isDark: boolean } {
  const isDark = useColorScheme() === "dark";
  return { colors: isDark ? darkColors : lightColors, isDark };
}

export const avatarPalette = ["#6C4ADA", "#2F8FD6", "#D68A2F"] as const;

export function avatarColorForSlot(slot: number): string {
  return avatarPalette[(slot - 1) % avatarPalette.length];
}

/**
 * Typeface for the product surfaces.
 *
 * Android maps `fontWeight` onto a custom family badly -- it synthesises a
 * faux-bold on top of an already-bold face, which is why the weight lives in
 * the family name here and styles set `fontFamily` *instead of* `fontWeight`
 * rather than alongside it.
 *
 * Loaded once in `app/_layout.tsx`; `fontsReady` there gates the first paint so
 * text never renders in the system fallback and then reflows.
 */
export const fonts = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  extrabold: "PlusJakartaSans_800ExtraBold"
} as const;

export const radius = { sm: 12, md: 15, lg: 16, xl: 26, pill: 999 } as const;

export const spacing = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28 } as const;
