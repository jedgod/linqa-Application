import { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { relativeAge, type HideableHomeSection, type HomeUpcomingEvent, type HomeVaultItem } from "../../services/home-feed.service";

/** Stories carried by the hero pager, one per dot. */
export const HERO_SLOTS = 4;

/** World cards per page, and pages, in "Breaking around the world". */
export const WORLD_PER_PAGE = 3;

export const WORLD_PAGES = 5;

export type HomeUpcomingCard = HomeUpcomingEvent & {
  suggested?: boolean;
  displayPlace?: { icon: string; label: string };
};

export const UPCOMING_SUGGESTIONS = [
  { title: "Design Review Meeting", daysFromNow: 1, hour: 10, minute: 30, icon: "videocam-outline", label: "Video call plan" },
  { title: "Community Event: AI & You", daysFromNow: 3, hour: 14, minute: 0, icon: "globe-outline", label: "Online event plan" },
  { title: "Product Team Standup", daysFromNow: 5, hour: 18, minute: 0, icon: "videocam-outline", label: "Google Meet plan" },
  { title: "Flight Check-in and Itinerary", daysFromNow: 7, hour: 8, minute: 0, icon: "airplane-outline", label: "Travel plan" }
] as const;

export const SECTION_LABELS: Record<HideableHomeSection, string> = {
  liveUpdates: "Live updates",
  spotlight: "Spotlight",
  upcoming: "Upcoming events",
  continueYourDay: "Continue your day",
  countryLinqa: "CountryLinqa",
  breakingAroundWorld: "Breaking around the world"
};

export const DEGRADED_LABELS: Record<string, string> = {
  profile: "your profile",
  notifications: "your unread counts",
  countryLinqa: "CountryLinqa",
  upcoming: "upcoming events",
  continueYourDay: "your conversations",
  vault: "your Vault",
  transfers: "money in flight",
  liveUpdates: "live updates",
  spotlight: "spotlight",
  news: "world news",
  snapshot: "activity history"
};

/**
 * Vault items arrive without a name: `vault_items.name_ciphertext` is
 * encrypted with a key the server never holds. The card is therefore labelled
 * from the item type, which is the one unencrypted fact about it.
 */
export const VAULT_LABELS: Record<HomeVaultItem["itemType"], string> = {
  DOCUMENT: "Encrypted document",
  IDENTITY: "Identity item",
  PHOTO: "Encrypted photo",
  RECOVERY: "Recovery item",
  OTHER: "Encrypted item"
};

export const VAULT_ICONS: Record<HomeVaultItem["itemType"], { icon: string; tint: string; accent: string }> = {
  DOCUMENT: { icon: "document-text", tint: "#E23A3A", accent: "#FEECEC" },
  IDENTITY: { icon: "id-card", tint: "#2563EB", accent: "#E8EDFF" },
  PHOTO: { icon: "image", tint: "#8B5CF6", accent: "#F3E8FF" },
  RECOVERY: { icon: "key", tint: "#F59E0B", accent: "#FEF3C7" },
  OTHER: { icon: "lock-closed", tint: "#475569", accent: "#EEF2F7" }
};

/** Category accents for the world rail, keyed to `HOME_NEWS_CATEGORIES`. */
export const CATEGORY_COLORS: Record<string, string> = {
  WORLD: "#6366F1",
  POLITICS: "#F43F5E",
  TECHNOLOGY: "#8B5CF6",
  HEALTH: "#22C55E",
  CLIMATE: "#14B8A6",
  BUSINESS: "#F59E0B",
  SCIENCE: "#06B6D4",
  SPORTS: "#3B82F6",
  GENERAL: "#94A3B8"
};

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function initialsOf(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

export function humanizeCategory(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(
    ...code.toUpperCase().split("").map((character) => 127397 + character.charCodeAt(0))
  );
}

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[(category ?? "").toUpperCase()] ?? CATEGORY_COLORS.GENERAL;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

/** A refresh can shorten the feed under a page index the user already left. */
export function clampPage(page: number, pageCount: number): number {
  return Math.max(0, Math.min(page, pageCount - 1));
}

/** Maps a paged scroll offset back to a page index for the dot rail. */
export function pageTracker(pageWidth: number, onPage: (page: number) => void) {
  return (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pageWidth <= 0) return;
    onPage(Math.round(event.nativeEvent.contentOffset.x / pageWidth));
  };
}

export function eventPlace(event: HomeUpcomingEvent): { icon: string; label: string } {
  if (event.city) return { icon: "location-outline", label: event.city };
  if (event.countryCode) return { icon: "flag-outline", label: event.countryCode.toUpperCase() };
  return { icon: "globe-outline", label: "Online event" };
}

/**
 * `relativeAge` yields "now", a "12m"/"3h"/"2d" span, or a calendar date once
 * a week has passed. Only the middle form reads correctly with "ago".
 */
export function updatedLabel(value: string): string {
  const age = relativeAge(value);
  if (!age) return "Updated recently";
  if (age === "now") return "Updated just now";
  if (/^\d+[mhd]$/.test(age)) return `Updated ${age} ago`;
  return `Updated ${age}`;
}

export function byteLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function compactCount(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/**
 * Currencies whose smallest unit *is* the unit. Everything else in the
 * LinqaSend corridors is two-decimal, matching the rest of the money screens.
 */
export const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW",
  "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"
]);

/**
 * Symbols only where the symbol is unambiguous. A bare "$" for CAD or AUD
 * would misstate the amount, so those fall through to the ISO code.
 */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  INR: "₹",
  NGN: "₦"
};

export function moneyLabel(minor: string, currency: string): string {
  const code = (currency ?? "").toUpperCase();
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(code);
  const units = zeroDecimal ? Number(minor) : Number(minor) / 100;
  if (!Number.isFinite(units)) return `${minor} ${code}`.trim();
  const amount = units.toLocaleString(undefined, {
    minimumFractionDigits: zeroDecimal ? 0 : 2,
    maximumFractionDigits: zeroDecimal ? 0 : 2
  });
  const symbol = CURRENCY_SYMBOLS[code];
  return symbol ? `${symbol}${amount}` : `${amount} ${code}`.trim();
}

/** "AWAITING_CONFIRMATION" -> "Awaiting confirmation". */
export function transferStatusLabel(status: string): string {
  const words = (status ?? "").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
