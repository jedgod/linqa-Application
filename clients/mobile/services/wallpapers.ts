import { THEMES, type Theme } from "./conversation-engine";

/**
 * Chat wallpapers. Pure data and helpers (no React Native imports) so the catalog and the
 * resolution rules can be unit tested under Node.
 *
 * One wallpaper is the person's default ("main") for every chat; any single chat can override it.
 * Wallpapers only change how a chat looks to the person who picked one. Nobody else is told.
 */
export type WallpaperCategory = "Patterns & Doodles" | "Minimalist Solids" | "Vibrant Gradients" | "Premium Abstract";

export interface Wallpaper {
  id: string;
  name: string;
  category: WallpaperCategory;
  /** One colour is a solid; two or more are gradient stops, first to last. */
  bgColors: readonly string[];
  hasDoodle?: boolean;
  /** Fill of the person's own message bubbles on this wallpaper. */
  accentColor: string;
  isDark: boolean;
}

export const WALLPAPER_CATEGORIES: readonly WallpaperCategory[] = ["Patterns & Doodles", "Minimalist Solids", "Vibrant Gradients", "Premium Abstract"];

/** The wallpaper everyone starts with, and the fallback for any unknown or removed id. */
export const DEFAULT_WALLPAPER_ID = "theme_01";

export const WALLPAPERS: readonly Wallpaper[] = [
  // Patterns & Doodles
  { id: "theme_01", name: "Classic Dark Doodle", category: "Patterns & Doodles", bgColors: ["#0B141A"], hasDoodle: true, accentColor: "#005C4B", isDark: true },
  { id: "theme_02", name: "Vintage Lavender", category: "Patterns & Doodles", bgColors: ["#2E2538"], hasDoodle: true, accentColor: "#6B4294", isDark: true },
  { id: "theme_03", name: "Sage Garden", category: "Patterns & Doodles", bgColors: ["#1E2C24"], hasDoodle: true, accentColor: "#2B5C3F", isDark: true },
  { id: "theme_04", name: "Crimson Sketch", category: "Patterns & Doodles", bgColors: ["#2C1414"], hasDoodle: true, accentColor: "#7C2D12", isDark: true },
  { id: "theme_05", name: "Light Mode Original", category: "Patterns & Doodles", bgColors: ["#EFEAE2"], hasDoodle: true, accentColor: "#E1F3D4", isDark: false },
  { id: "theme_06", name: "Slate Grid Sketch", category: "Patterns & Doodles", bgColors: ["#1E293B"], hasDoodle: true, accentColor: "#0369A1", isDark: true },
  { id: "theme_07", name: "Cyberpunk Wire", category: "Patterns & Doodles", bgColors: ["#0F061E"], hasDoodle: true, accentColor: "#A21CAF", isDark: true },
  { id: "theme_08", name: "Nordic Snow Doodle", category: "Patterns & Doodles", bgColors: ["#F8FAFC"], hasDoodle: true, accentColor: "#E0F2FE", isDark: false },

  // Minimalist Solids
  { id: "theme_09", name: "Absolute Dark", category: "Minimalist Solids", bgColors: ["#000000"], accentColor: "#1F2937", isDark: true },
  { id: "theme_10", name: "Charcoal Grey", category: "Minimalist Solids", bgColors: ["#1F222A"], accentColor: "#00A884", isDark: true },
  { id: "theme_11", name: "Deep Sea Navy", category: "Minimalist Solids", bgColors: ["#0F172A"], accentColor: "#2563EB", isDark: true },
  { id: "theme_12", name: "Forest Green", category: "Minimalist Solids", bgColors: ["#064E3B"], accentColor: "#059669", isDark: true },
  { id: "theme_13", name: "Lilac Mist", category: "Minimalist Solids", bgColors: ["#F3E8FF"], accentColor: "#D8B4FE", isDark: false },
  { id: "theme_14", name: "Blush Pink", category: "Minimalist Solids", bgColors: ["#FCE7F3"], accentColor: "#FBCFE8", isDark: false },
  { id: "theme_15", name: "Chocolate Cocoa", category: "Minimalist Solids", bgColors: ["#292524"], accentColor: "#78350F", isDark: true },

  // Vibrant Gradients
  { id: "theme_16", name: "Midnight Aurora", category: "Vibrant Gradients", bgColors: ["#0F172A", "#1E1B4B", "#311042"], accentColor: "#4F46E5", isDark: true },
  { id: "theme_17", name: "Sunset Glow", category: "Vibrant Gradients", bgColors: ["#4C0519", "#7C2D12"], accentColor: "#EA580C", isDark: true },
  { id: "theme_18", name: "Neon Purple Candy", category: "Vibrant Gradients", bgColors: ["#2E1065", "#581C87"], accentColor: "#9333EA", isDark: true },
  { id: "theme_19", name: "Electric Teal Twist", category: "Vibrant Gradients", bgColors: ["#042F1A", "#065F46"], accentColor: "#0D9488", isDark: true },
  { id: "theme_20", name: "Pastel Sunrise", category: "Vibrant Gradients", bgColors: ["#FFEDD5", "#FCE7F3"], accentColor: "#FDA4AF", isDark: false },
  { id: "theme_21", name: "Oceanic Blue Fade", category: "Vibrant Gradients", bgColors: ["#0B1E36", "#1E3A8A"], accentColor: "#3B82F6", isDark: true },
  { id: "theme_22", name: "Solar Energy", category: "Vibrant Gradients", bgColors: ["#FEF08A", "#FED7AA"], accentColor: "#F59E0B", isDark: false },
  { id: "theme_23", name: "Cyber Velvet", category: "Vibrant Gradients", bgColors: ["#111827", "#4C1D95"], accentColor: "#DB2777", isDark: true },

  // Premium Abstract
  { id: "theme_24", name: "Hyper Obsidian", category: "Premium Abstract", bgColors: ["#030712", "#111827"], accentColor: "#374151", isDark: true },
  { id: "theme_25", name: "Monochrome Velvet", category: "Premium Abstract", bgColors: ["#18181B", "#27272A"], accentColor: "#52525B", isDark: true },
  { id: "theme_26", name: "Eucalyptus Mist", category: "Premium Abstract", bgColors: ["#ECFDF5", "#D1FAE5"], accentColor: "#A7F3D0", isDark: false },
  { id: "theme_27", name: "Volcanic Core", category: "Premium Abstract", bgColors: ["#1C1917", "#44403C"], accentColor: "#EF4444", isDark: true },
  { id: "theme_28", name: "Royal Sapphire", category: "Premium Abstract", bgColors: ["#172554", "#1E3A8A"], accentColor: "#2563EB", isDark: true },
  { id: "theme_29", name: "Acid Limelight", category: "Premium Abstract", bgColors: ["#052E16", "#14532D"], accentColor: "#84CC16", isDark: true },
  { id: "theme_30", name: "Orchid Dreamscape", category: "Premium Abstract", bgColors: ["#300C3A", "#120316"], accentColor: "#EC4899", isDark: true }
];

/** How much the wallpaper is darkened behind messages (0 = none), in the steps the picker offers. */
export const DIM_STEPS: readonly number[] = [0, 0.15, 0.3, 0.45, 0.6];
export const DEFAULT_DIM = 0;

/** Reads a stored or typed dim level; anything unreadable is off, and values snap to the nearest offered step. */
export function parseDim(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_DIM;
  const clamped = Math.min(DIM_STEPS[DIM_STEPS.length - 1]!, Math.max(0, n));
  return DIM_STEPS.reduce((best, step) => (Math.abs(step - clamped) < Math.abs(best - clamped) ? step : best), DIM_STEPS[0]!);
}

export const isWallpaperId =(value: unknown): value is string => typeof value === "string" && WALLPAPERS.some((w) => w.id === value);

/** Unknown, missing or removed ids fall back to the default wallpaper. */
export function getWallpaper(id: string | null | undefined): Wallpaper {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS.find((w) => w.id === DEFAULT_WALLPAPER_ID)!;
}

/** What the wallpaper becomes when nothing has been chosen and the phone is in light appearance (dark uses the built-in default). */
export const LIGHT_SYSTEM_WALLPAPER_ID = "theme_05";

/** The wallpaper that matches the phone's appearance. Unknown or missing appearance counts as dark, the built-in default. */
export function systemWallpaperId(scheme: string | null | undefined): string {
  return scheme === "light" ? LIGHT_SYSTEM_WALLPAPER_ID : DEFAULT_WALLPAPER_ID;
}

/**
 * This chat's own choice wins, then the person's default. With neither, the wallpaper matches the phone's light or dark
 * appearance (Light Mode Original, or Classic Dark Doodle) and follows it live. `explicit` is false only in that last case.
 */
export function resolveWallpaper(
  chatId: string | null | undefined,
  defaultId: string | null | undefined,
  systemScheme?: string | null
): { wallpaper: Wallpaper; explicit: boolean } {
  if (isWallpaperId(chatId)) return { wallpaper: getWallpaper(chatId), explicit: true };
  if (isWallpaperId(defaultId)) return { wallpaper: getWallpaper(defaultId), explicit: true };
  return { wallpaper: getWallpaper(systemWallpaperId(systemScheme)), explicit: false };
}

const channel = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text colour that reads best on `fill`: white or the app's dark ink, whichever contrasts more (mid-tones need full white). */
export function readableOn(fill: string): string {
  const light = "#FFFFFF";
  const dark = THEMES.light.ink;
  return contrastRatio(fill, light) >= contrastRatio(fill, dark) ? light : dark;
}

/** `hex` darkened by a black mask of the given opacity, as the dimming layer draws it. */
export function dimmed(hex: string, dim: number): string {
  if (!(dim > 0)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const k = 1 - Math.min(1, Math.max(0, dim));
  const part = (shift: number) => Math.round(((n >> shift) & 255) * k).toString(16).padStart(2, "0");
  return `#${part(16)}${part(8)}${part(0)}`;
}

/**
 * The chat palette for a wallpaper: the dark or light palette, whichever reads better on the backdrop as it looks
 * after dimming (a bright wallpaper dimmed far enough needs light text), with the wallpaper's colour behind the thread
 * and its accent as the person's own bubbles (with text that stays readable on that accent).
 */
export function wallpaperTheme(wallpaper: Wallpaper, dim = 0): Theme {
  const backdrop = dimmed(wallpaper.bgColors[0]!, dim);
  const palette = contrastRatio(THEMES.dark.ink, backdrop) >= contrastRatio(THEMES.light.ink, backdrop) ? THEMES.dark : THEMES.light;
  return { ...palette, background: backdrop, outgoing: wallpaper.accentColor, onOutgoing: readableOn(wallpaper.accentColor) };
}
