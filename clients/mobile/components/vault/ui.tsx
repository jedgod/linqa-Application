import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { getApiBaseUrl } from "../../config/api";
import { accessTokenProvider } from "../../services/session";
import { VaultService, type EncryptedVaultItem, type VaultIntegrationStatus } from "../../services/vault.service";
import { fonts } from "../../theme/tokens";

/** Linqa Vault's dark design, from the approved mockups. */
export const vault = {
  bg: "#07121F",
  card: "#0E1D2E",
  cardHi: "#122437",
  border: "#1B2E43",
  text: "#F1F5F9",
  muted: "#94A3B8",
  faint: "#64748B",
  blue: "#2563EB",
  blueText: "#60A5FA",
  green: "#22C55E",
  purple: "#8B5CF6",
  amber: "#FBBF24",
  orange: "#F97316",
  red: "#EF4444"
} as const;

export type VaultTab = "home" | "files" | "share" | "more";
type IconName = keyof typeof Ionicons.glyphMap;

export interface VaultData {
  items: EncryptedVaultItem[] | null;
  status: VaultIntegrationStatus | null;
  error: string | null;
  reload: () => void;
}

/** Loads the item index and the server-reported capability status each time the screen is focused. */
export function useVaultData(): VaultData {
  const client = useMemo(() => new VaultService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()), []);
  const [items, setItems] = useState<EncryptedVaultItem[] | null>(null);
  const [status, setStatus] = useState<VaultIntegrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    Promise.all([client.listItems(), client.integrationStatus()]).then(
      ([list, state]) => { if (active) { setItems(list.items); setStatus(state); } },
      (cause) => { if (active) { setItems((current) => current ?? []); setError(cause instanceof Error ? cause.message.replace(/_/g, " ") : "Unable to load your vault"); } }
    );
    return () => { active = false; };
  }, [client, tick]));

  return { items, status, error, reload: () => setTick((n) => n + 1) };
}

export function VaultScreen({ children, tab, tabs = true }: { children: ReactNode; tab?: VaultTab; tabs?: boolean }) {
  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="light" />
      {children}
      {tabs ? <VaultTabBar active={tab} /> : null}
    </SafeAreaView>
  );
}

export function VaultHeader({ title, subtitle, back, right }: { title: string; subtitle?: string; back?: boolean; right?: ReactNode }) {
  const router = useRouter();
  return (
    <View style={s.header}>
      {back ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.headerButton} onPress={() => (router.canGoBack() ? router.back() : router.replace("/vault"))}>
          <Ionicons name="arrow-back" size={24} color={vault.text} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={[s.title, back && { textAlign: "center" }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[s.subtitle, back && { textAlign: "center" }]}>{subtitle}</Text> : null}
      </View>
      {right ?? (back ? <View style={s.headerButton} /> : null)}
    </View>
  );
}

export function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={s.headerButton} onPress={onPress}>
      <Ionicons name={icon} size={22} color={vault.text} />
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(value) }}>
      <View style={[s.fill, { width: `${Math.max(0, Math.min(100, value))}%` }]} />
    </View>
  );
}

const FILE_ICON: Record<string, { icon: IconName; bg: string }> = {
  DOCUMENT: { icon: "document-text", bg: "#2563EB" },
  IDENTITY: { icon: "id-card", bg: "#8B5CF6" },
  PHOTO: { icon: "image", bg: "#F97316" },
  RECOVERY: { icon: "key", bg: "#EF4444" },
  OTHER: { icon: "document", bg: "#475569" }
};

export function FileIcon({ type, size = 40 }: { type: string; size?: number }) {
  const spec = FILE_ICON[type] ?? FILE_ICON.OTHER!;
  return (
    <View style={[s.fileIcon, { width: size - 4, height: size, backgroundColor: spec.bg }]}>
      <Ionicons name={spec.icon} size={size * 0.5} color="#FFFFFF" />
    </View>
  );
}

export function FolderIcon({ size = 34 }: { size?: number }) {
  return <Ionicons name="folder" size={size} color={vault.amber} />;
}

export function Tile({ icon, color, title, subtitle, onPress, trailing, disabled }: { icon: IconName; color: string; title: string; subtitle: string; onPress: () => void; trailing?: ReactNode; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} accessibilityLabel={`${title}. ${subtitle}`} style={[s.tile, disabled && { opacity: 0.6 }]} onPress={onPress}>
      <View style={[s.tileIcon, { backgroundColor: color }]}><Ionicons name={icon} size={22} color="#FFFFFF" /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.tileTitle}>{title}</Text>
        <Text style={s.tileSub}>{subtitle}</Text>
      </View>
      {trailing ?? <Ionicons name="chevron-forward" size={18} color={vault.faint} />}
    </Pressable>
  );
}

export function Badge({ text, tone }: { text: string; tone: "ok" | "off" }) {
  // The words carry the meaning, not just the colour.
  return <Text style={[s.badge, { color: tone === "ok" ? vault.green : vault.amber }]}>{text}</Text>;
}

export function Notice({ text, tone = "info", action }: { text: string; tone?: "info" | "warn"; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={[s.notice, tone === "warn" ? { backgroundColor: "#3A2A0B" } : { backgroundColor: "#0F2A4D" }]}>
      <Ionicons name={tone === "warn" ? "alert-circle-outline" : "shield-checkmark-outline"} size={18} color={tone === "warn" ? vault.amber : vault.blueText} />
      <View style={{ flex: 1 }}>
        <Text style={[s.noticeText, { color: tone === "warn" ? "#FDE7B0" : "#BBD6FB" }]}>{text}</Text>
        {action ? <Pressable accessibilityRole="button" onPress={action.onPress}><Text style={s.noticeAction}>{action.label}</Text></Pressable> : null}
      </View>
    </View>
  );
}

export function Loading() {
  return <ActivityIndicator color={vault.blueText} style={{ marginTop: 40 }} />;
}

export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} style={[s.primary, disabled && { opacity: 0.45 }]} onPress={onPress}>
      <Text style={s.primaryText}>{label}</Text>
    </Pressable>
  );
}

const TABS: Array<{ key: Exclude<VaultTab, never>; label: string; icon: IconName; active: IconName; route: string }> = [
  { key: "home", label: "Home", icon: "home-outline", active: "home", route: "/vault" },
  { key: "files", label: "Files", icon: "folder-outline", active: "folder", route: "/vault/files" },
  { key: "share", label: "Share", icon: "share-social-outline", active: "share-social", route: "/vault/share" },
  { key: "more", label: "More", icon: "ellipsis-horizontal", active: "ellipsis-horizontal", route: "/vault/security" }
];

export function VaultTabBar({ active }: { active?: VaultTab }) {
  const router = useRouter();
  const go = (route: string) => router.replace(route as never);
  const tab = (t: (typeof TABS)[number]) => {
    const on = t.key === active;
    return (
      <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label} style={s.tab} onPress={() => { if (!on) go(t.route); }}>
        <Ionicons name={on ? t.active : t.icon} size={22} color={on ? vault.blueText : vault.muted} />
        <Text style={[s.tabLabel, { color: on ? vault.blueText : vault.muted }]}>{t.label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={s.tabBar}>
      {tab(TABS[0]!)}
      {tab(TABS[1]!)}
      <View style={s.tab}>
        <Pressable accessibilityRole="button" accessibilityLabel="Add to vault" style={s.plus} onPress={() => router.push("/vault/intake")}>
          <Ionicons name="add" size={30} color="#FFFFFF" />
        </Pressable>
      </View>
      {tab(TABS[2]!)}
      {tab(TABS[3]!)}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: vault.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, minHeight: 56 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: vault.text, fontFamily: fonts.semibold, fontSize: 22, paddingLeft: 8 },
  subtitle: { color: vault.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2, paddingLeft: 8 },
  card: { backgroundColor: vault.card, borderRadius: 18, borderWidth: 1, borderColor: vault.border },
  track: { height: 6, borderRadius: 3, backgroundColor: "#1E3248", overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: vault.blue },
  fileIcon: { borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tile: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: vault.card, borderRadius: 18, borderWidth: 1, borderColor: vault.border, padding: 14, marginBottom: 12 },
  tileIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tileTitle: { color: vault.text, fontFamily: fonts.semibold, fontSize: 15 },
  tileSub: { color: vault.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 },
  badge: { fontFamily: fonts.semibold, fontSize: 12 },
  notice: { flexDirection: "row", gap: 10, borderRadius: 14, padding: 14 },
  noticeText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  noticeAction: { color: vault.blueText, fontFamily: fonts.bold, fontSize: 13, marginTop: 8 },
  primary: { height: 52, borderRadius: 14, backgroundColor: vault.blue, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 16 },
  tabBar: { flexDirection: "row", alignItems: "flex-end", backgroundColor: "#081523", borderTopWidth: 1, borderTopColor: vault.border, paddingBottom: 8, paddingTop: 6 },
  tab: { flex: 1, alignItems: "center", justifyContent: "flex-end", minHeight: 48, gap: 3 },
  tabLabel: { fontFamily: fonts.medium, fontSize: 11 },
  plus: { width: 56, height: 56, borderRadius: 28, backgroundColor: vault.blue, alignItems: "center", justifyContent: "center", marginTop: -26, borderWidth: 4, borderColor: "#081523" }
});
