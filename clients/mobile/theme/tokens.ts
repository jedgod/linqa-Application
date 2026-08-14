/**
 * Shared design tokens. Extracted from the colors/radii already duplicated
 * across every auth/account screen (see git history pre-2026-08-09) rather
 * than introduced from scratch, so this is a consolidation, not a rebrand.
 */
export const colors = {
  bg: "#001520",
  surface: "#082536",
  surfaceAlt: "#073B3C",
  border: "#17445A",
  text: "#F5FBFF",
  textMuted: "#8098A9",
  textFaint: "#60798C",
  accent: "#12D6AE",
  onAccent: "#00212A",
  danger: "#FF8B97",
  dangerBg: "#2A1620",
  overlay: "rgba(0,0,0,0.62)"
} as const;

export const avatarPalette = ["#6C4ADA", "#2F8FD6", "#D68A2F"] as const;

export function avatarColorForSlot(slot: number): string {
  return avatarPalette[(slot - 1) % avatarPalette.length];
}

export const radius = { sm: 12, md: 15, lg: 16, xl: 26, pill: 999 } as const;

export const spacing = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28 } as const;
