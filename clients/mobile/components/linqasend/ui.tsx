import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { fonts } from "../../theme/tokens";

/** LinqaSend's light design, from the approved mockups. */
export const send = {
  bg: "#FFFFFF",
  surface: "#F5F6FB",
  border: "#E7E9F2",
  text: "#101828",
  muted: "#667085",
  faint: "#98A2B3",
  primary: "#4F3FE0",
  primarySoft: "#EEF0FF",
  success: "#12A150",
  warning: "#B54708",
  danger: "#D92D20",
  star: "#F5A524"
} as const;

const AVATAR_COLORS = ["#4F3FE0", "#0E9F6E", "#D9480F", "#0B7285", "#9C36B5", "#C2255C", "#1864AB", "#5F3DC4"];

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0]![0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] ?? "" : parts[0]![1] ?? "")).toUpperCase();
}

function colorFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

/** Initials avatar. No stock photos: people shown here are the user's real recipients. */
export function Avatar({ name, size = 52 }: { name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colorFor(name), alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#FFFFFF", fontFamily: fonts.bold, fontSize: size * 0.34 }}>{initialsOf(name)}</Text>
    </View>
  );
}

/** "GH" -> "Ghana". Falls back to the code if the runtime has no region names. */
export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code.toUpperCase();
  }
}

export function deliveryLabel(recipientType: string | undefined): string {
  switch (recipientType) {
    case "LINQA_USER": return "Linqa user";
    case "MOBILE_WALLET": return "Mobile Money";
    case "CARD": return "Card";
    default: return "Bank";
  }
}

/**
 * LinqaSend screens are light, so the status bar (time, signal, wifi, battery) must use dark
 * icons. With the app's default "auto" style they were drawn white on white and disappeared.
 */
export function LinqaSendStatusBar() {
  return <StatusBar style="dark" />;
}

const CURRENCY_REGION: Record<string, string> = { EUR: "EU", XOF: "SN", XAF: "CM", XCD: "AG", ANG: "CW", XPF: "PF" };

/** Flag emoji for a currency code ("USD" -> 🇺🇸, "GHS" -> 🇬🇭). Unknown codes show a globe. */
export function currencyFlag(currency: string): string {
  const code = currency.toUpperCase();
  const region = CURRENCY_REGION[code] ?? code.slice(0, 2);
  if (!/^[A-Z]{2}$/.test(region)) return "🌐";
  return String.fromCodePoint(...[...region].map((letter) => 127397 + letter.charCodeAt(0)));
}

/** Minor units (cents) to "5,319.00". */
export function formatMinor(minor: string | number, digits = 2): string {
  return (Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

type Tab = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap; route: string };
const TABS: Tab[] = [
  { key: "home", label: "Home", icon: "home-outline", activeIcon: "home", route: "/linqasend" },
  { key: "send", label: "Send", icon: "paper-plane-outline", activeIcon: "paper-plane", route: "/linqasend/send" },
  { key: "activity", label: "Activity", icon: "document-text-outline", activeIcon: "document-text", route: "/linqasend/history" },
  { key: "cards", label: "Cards", icon: "card-outline", activeIcon: "card", route: "/linqasend/payment-methods" },
  { key: "more", label: "More", icon: "ellipsis-vertical", activeIcon: "ellipsis-vertical", route: "/linqasend/controls" }
];

export function LinqaSendTabBar({ active }: { active: "home" | "send" | "activity" | "cards" | "more" }) {
  const router = useRouter();
  return (
    <View style={styles.tabBar}>
      {TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            style={styles.tab}
            onPress={() => { if (!selected) router.replace(tab.route as never); }}
          >
            <Ionicons name={selected ? tab.activeIcon : tab.icon} size={23} color={selected ? send.primary : send.faint} />
            <Text style={[styles.tabLabel, { color: selected ? send.primary : send.faint }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: send.border, backgroundColor: send.bg, paddingTop: 8, paddingBottom: 10 },
  tab: { flex: 1, alignItems: "center", gap: 3, minHeight: 48, justifyContent: "center" },
  tabLabel: { fontFamily: fonts.medium, fontSize: 12 }
});
