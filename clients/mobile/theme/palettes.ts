/** Pure palette data (no React Native imports) so it can be unit tested under Node. */
export type Palette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  onAccent: string;
  danger: string;
  dangerBg: string;
  warning: string;
  warningBg: string;
  warningBorder: string;
  overlay: string;
};

/** Dark palette (original Linqa teal). Text pairs are all >= 4.5:1 on bg and surface. */
export const darkColors: Palette = {
  bg: "#001520",
  surface: "#082536",
  surfaceAlt: "#073B3C",
  border: "#17445A",
  text: "#F5FBFF",
  textMuted: "#9BB0BF",
  textFaint: "#7A94A8",
  accent: "#12D6AE",
  onAccent: "#00212A",
  danger: "#FF8B97",
  dangerBg: "#2A1620",
  warning: "#F6C453",
  warningBg: "#2B2517",
  warningBorder: "#6B5521",
  overlay: "rgba(0,0,0,0.62)"
};

/** Light palette, matching the blue-primary onboarding mockups. Text pairs are all >= 4.5:1. */
export const lightColors: Palette = {
  bg: "#F6F8FC",
  surface: "#FFFFFF",
  surfaceAlt: "#EAF1FF",
  border: "#D5DEEA",
  text: "#0B1B2B",
  textMuted: "#4B5E72",
  textFaint: "#5F7185",
  accent: "#165DFF",
  onAccent: "#FFFFFF",
  danger: "#C0283C",
  dangerBg: "#FDECEE",
  warning: "#8A5A00",
  warningBg: "#FFF4DB",
  warningBorder: "#E0B04A",
  overlay: "rgba(0,0,0,0.4)"
};
