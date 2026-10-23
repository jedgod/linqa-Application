import { useMemo, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { WorkspaceApiError } from "../../services/workspace.service";
import { fonts, radius, useTheme, type Palette } from "../../theme/tokens";

/** Shared building blocks for Notes, Calendar and Enterprise so the three read as one family and stay compact. */
export function useKit() {
  const { colors, isDark } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return { colors, isDark, s };
}

export function Screen({ title, subtitle, onClose, right, children }: { title: string; subtitle?: string; onClose: () => void; right?: ReactNode; children: ReactNode }) {
  const { colors, isDark, s } = useKit();
  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title} accessibilityRole="header">{title}</Text>
          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        </View>
        {right}
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={onClose} style={s.close}>
          <Ionicons name="close" size={20} color={colors.text} />
        </Pressable>
      </View>
      {children}
    </SafeAreaView>
  );
}

export function Loading() {
  const { colors, s } = useKit();
  return <View style={s.center}><ActivityIndicator color={colors.accent} size="large" /></View>;
}

export function Empty({ icon, title, copy, action }: { icon: keyof typeof Ionicons.glyphMap; title: string; copy: string; action?: { label: string; onPress: () => void } }) {
  const { colors, s } = useKit();
  return (
    <View style={s.center}>
      <Ionicons name={icon} size={30} color={colors.textFaint} />
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={[s.muted, { textAlign: "center" }]}>{copy}</Text>
      {action ? <Pressable accessibilityRole="button" style={s.primary} onPress={action.onPress}><Text style={s.primaryText}>{action.label}</Text></Pressable> : null}
    </View>
  );
}

export function Banner({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  const { colors, s } = useKit();
  return (
    <View accessibilityRole="alert" style={[s.banner, tone === "error" ? { backgroundColor: colors.dangerBg, borderColor: colors.danger } : { backgroundColor: colors.warningBg, borderColor: colors.warningBorder }]}>
      <Text style={[s.bannerText, { color: tone === "error" ? colors.danger : colors.warning }]}>{children}</Text>
    </View>
  );
}

/** A message a person can act on for any failure; server wording is never shown. */
export function failureText(error: unknown, what: string): string {
  if (__DEV__) console.warn(`workspace: could not ${what}:`, error);
  if (error instanceof WorkspaceApiError) {
    if (error.status === 401) return "Sign in again to continue.";
    if (error.status === 403) return "This account doesn't have access to that.";
    if (error.status === 404) return "That item no longer exists.";
    if (error.code === "INVALID_EVENT_TIME") return "The event has to end after it starts.";
    if (error.status === 400 || error.status === 422) return `We couldn't ${what} with those details.`;
    return `We couldn't ${what}. Try again in a moment.`;
  }
  if (error instanceof Error && /authenticated session|sign in/i.test(error.message)) return "Sign in again to continue.";
  if (error instanceof TypeError || (error instanceof Error && /network|fetch|offline/i.test(error.message))) return "You're offline. Connect to the internet and try again.";
  return `We couldn't ${what}. Try again in a moment.`;
}

const makeStyles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
  title: { fontFamily: fonts.extrabold, fontSize: 22, color: c.text },
  subtitle: { fontFamily: fonts.regular, fontSize: 12, color: c.textMuted, marginTop: 1 },
  close: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 28 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: c.text, textAlign: "center" },
  muted: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: c.textMuted },
  primary: { flexDirection: "row", gap: 8, backgroundColor: c.accent, borderRadius: 12, minHeight: 44, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", marginTop: 6 },
  primaryText: { fontFamily: fonts.bold, fontSize: 14, color: c.onAccent },
  banner: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8, marginHorizontal: 16, marginBottom: 8 },
  bannerText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17 }
});
