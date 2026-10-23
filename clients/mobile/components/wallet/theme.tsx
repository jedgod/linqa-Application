import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fonts } from "../../theme/tokens";
import { currencyDisplay, formatMoney } from "../../services/wallet-format";
import { setWalletDemo, useWalletDemo } from "../../services/wallet-demo-mode";

/** Deep navy palette shared by every Wallet screen: indigo-blue cards, bright teal actions, white headings. */
export const wallet = {
  bg: "#091528",
  card: "#112447",
  cardBorder: "#1F3B70",
  raised: "#1A3366",
  text: "#F4F8FF",
  muted: "#9DB2D3",
  faint: "#6F88AE",
  teal: "#14F0DC",
  tealDeep: "#0FB8AB",
  tealSoft: "#0C3B4D",
  green: "#3DD68C",
  danger: "#F07178",
  onTeal: "#04202A"
} as const;

const TABS = [
  { key: "wallet", label: "Wallet", icon: "wallet-outline", active: "wallet", route: "/wallet" },
  { key: "activity", label: "Activity", icon: "time-outline", active: "time", route: "/wallet/activity" },
  { key: "send", label: "Send", icon: "paper-plane-outline", active: "paper-plane", route: "/wallet/send" },
  { key: "more", label: "More", icon: "ellipsis-horizontal-circle-outline", active: "ellipsis-horizontal-circle", route: "/wallet/more" }
] as const;

/**
 * Compact page header shared by every Wallet screen: the title on the left, optional actions, and the back arrow on the
 * right edge. Pass `onBack` only on pages you can go back from (the Wallet home and More root have no arrow).
 */
export function WalletHeader({ title, onBack, children }: { title: string; onBack?: () => void; children?: ReactNode }) {
  return (
    <View style={styles.head}>
      <Text accessibilityRole="header" style={styles.headTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{title}</Text>
      {children ? <View style={styles.headActions}>{children}</View> : null}
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8} style={styles.headBack} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color={wallet.teal} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function WalletTabBar({ active }: { active: (typeof TABS)[number]["key"] }) {
  const router = useRouter();
  const demo = useWalletDemo();
  return (
    <View>
    {demo ? (
      <View style={styles.demo} accessibilityRole="alert">
        <Text style={styles.demoText}>DEMO DATA · sample values, nothing is real</Text>
        <Pressable accessibilityRole="button" hitSlop={10} onPress={() => setWalletDemo(false)}><Text style={styles.demoLink}>Turn off</Text></Pressable>
      </View>
    ) : null}
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            style={styles.tab}
            onPress={() => router.navigate(tab.route as never)}
          >
            <Ionicons name={selected ? tab.active : tab.icon} size={22} color={selected ? wallet.teal : wallet.muted} />
            <Text numberOfLines={1} allowFontScaling={false} style={[styles.label, { color: selected ? wallet.teal : wallet.muted }]}>{tab.label}</Text>
            {selected ? <View style={styles.indicator} /> : null}
          </Pressable>
        );
      })}
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: wallet.cardBorder, backgroundColor: wallet.bg, paddingTop: 4, paddingBottom: 6 },
  tab: { flex: 1, alignItems: "center", gap: 2, minHeight: 44, justifyContent: "center" },
  label: { fontFamily: fonts.medium, fontSize: 11 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 4, minHeight: 48 },
  headTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 22, color: wallet.text },
  headActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  headBack: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: wallet.raised, backgroundColor: wallet.card, alignItems: "center", justifyContent: "center" },
  demo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: "#3B2A06", borderTopWidth: 1, borderTopColor: "#F5A524" },
  demoText: { flex: 1, fontFamily: fonts.semibold, fontSize: 12, color: "#F5C26B" },
  demoLink: { fontFamily: fonts.bold, fontSize: 12, color: "#F5A524" },
  indicator: { position: "absolute", bottom: 0, width: 56, height: 3, borderRadius: 2, backgroundColor: wallet.teal }
});

/** The locale's symbol for a currency (empty if the platform has none; the ISO code is then shown instead). */
export const currencySymbol = (currency: string): string => { const d = currencyDisplay(currency); return d.symbol === currency ? "" : d.symbol; };

/** Integer minor units to locale-formatted text; the ISO code is added wherever the symbol could be misread. */
export const moneyText = (minor: string, currency: string): string => formatMoney(minor, currency);
