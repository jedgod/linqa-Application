import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { fonts } from "../../theme/tokens";

/** The dark "Linqa module" look shared by Notes and Calendar. */
export const M = {
  bg: "#031A2A", card: "#0A2740", cardAlt: "#0D3050", border: "#14476E", accent: "#1677FF", teal: "#12D6AE",
  text: "#FFFFFF", muted: "#9FB6C9", faint: "#6E8CA5", danger: "#FF7B8A", dangerBg: "#2A1620", warn: "#F5A524"
} as const;

type HeaderButton = { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; active?: boolean };

/**
 * Screen frame: a teal "LINQA MODULE" label, the title, a line of context, optional round action buttons, and the back
 * arrow on the right.
 */
export function ModuleScreen({ title, subtitle, onBack, actions = [], children }: { title: string; subtitle?: string; onBack: () => void; actions?: HeaderButton[]; children: ReactNode }) {
  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="light" />
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>LINQA MODULE</Text>
          <Text style={s.title} accessibilityRole="header">{title}</Text>
          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        </View>
        {actions.length ? (
          <View style={s.actions}>
            {actions.map((a) => (
              <Pressable key={a.label} accessibilityRole="button" accessibilityLabel={a.label} accessibilityState={{ selected: !!a.active }} hitSlop={6} onPress={a.onPress} style={[s.round, a.active && { borderColor: M.accent }]}>
                <Ionicons name={a.icon} size={15} color={a.active ? M.accent : M.text} />
              </Pressable>
            ))}
          </View>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} onPress={onBack} style={s.back}>
          <Ionicons name="arrow-back" size={20} color={M.teal} />
        </Pressable>
      </View>
      {children}
    </SafeAreaView>
  );
}

export function Chip({ label, selected, onPress, icon, disabled }: { label: string; selected?: boolean; onPress?: () => void; icon?: keyof typeof Ionicons.glyphMap; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected, disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[s.chip, selected && s.chipOn, disabled && { opacity: 0.45 }]}>
      {icon ? <Ionicons name={icon} size={13} color={selected ? M.text : M.muted} /> : null}
      <Text style={[s.chipText, selected && { color: M.text, fontFamily: fonts.bold }]}>{label}</Text>
    </Pressable>
  );
}

export function Banner({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  return (
    <View accessibilityRole="alert" style={[s.banner, tone === "error" ? { backgroundColor: M.dangerBg, borderColor: M.danger } : { backgroundColor: "#2B2517", borderColor: "#6B5521" }]}>
      <Text style={[s.bannerText, { color: tone === "error" ? M.danger : M.warn }]}>{children}</Text>
    </View>
  );
}

export function Busy() {
  return <View style={s.center}><ActivityIndicator color={M.accent} size="large" /></View>;
}

export function EmptyState({ icon, title, copy, action }: { icon: keyof typeof Ionicons.glyphMap; title: string; copy: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={s.center}>
      <Ionicons name={icon} size={30} color={M.faint} />
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={[s.muted, { textAlign: "center" }]}>{copy}</Text>
      {action ? <Pressable accessibilityRole="button" style={s.primary} onPress={action.onPress}><Text style={s.primaryText}>{action.label}</Text></Pressable> : null}
    </View>
  );
}

export const moduleStyles = StyleSheet.create({
  card: { backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderRadius: 16 },
  input: { fontFamily: fonts.regular, fontSize: 13, color: M.text, backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 40 },
  label: { fontFamily: fonts.semibold, fontSize: 11.5, color: M.muted, marginTop: 4 },
  primary: { backgroundColor: M.accent, borderRadius: 12, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  primaryText: { fontFamily: fonts.bold, fontSize: 13.5, color: M.text },
  danger: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", minHeight: 36 },
  dangerText: { fontFamily: fonts.semibold, fontSize: 12.5, color: M.danger }
});

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: M.bg },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 },
  eyebrow: { fontFamily: fonts.extrabold, fontSize: 10, letterSpacing: 2.2, color: M.teal },
  title: { fontFamily: fonts.extrabold, fontSize: 24, lineHeight: 29, color: M.text },
  subtitle: { fontFamily: fonts.regular, fontSize: 12, color: M.muted, marginTop: 1 },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
  round: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: M.border, backgroundColor: M.card, alignItems: "center", justifyContent: "center" },
  back: { width: 32, height: 32, alignItems: "center", justifyContent: "center", marginTop: 4 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: M.border, borderRadius: 999, paddingHorizontal: 12, minHeight: 30, backgroundColor: M.card },
  chipOn: { backgroundColor: M.accent, borderColor: M.accent },
  chipText: { fontFamily: fonts.medium, fontSize: 12, color: M.muted },
  banner: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginHorizontal: 16, marginBottom: 8 },
  bannerText: { fontFamily: fonts.medium, fontSize: 11.5, lineHeight: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 28 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 15, color: M.text, textAlign: "center" },
  muted: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: M.muted },
  primary: { backgroundColor: M.accent, borderRadius: 12, minHeight: 42, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 6 },
  primaryText: { fontFamily: fonts.bold, fontSize: 13, color: M.text }
});
