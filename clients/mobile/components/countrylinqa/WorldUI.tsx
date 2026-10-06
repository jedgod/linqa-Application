import { useCallback, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { headline, locationLine, type PersonDetail } from "../../services/countrylinqa-world";
import { fonts } from "../../theme/tokens";
import { Avatar } from "../linqasend/ui";

/** Linqa World's light design (purple on white), from the approved mockups. */
export const world = { purple: "#5B3FE0", soft: "#F1EEFF", chip: "#EEF0FF", text: "#101828", muted: "#667085", faint: "#98A2B3", border: "#E7E9F2", danger: "#B42318", ok: "#1D6FEA" } as const;

export function WorldScreen({ children }: { children: ReactNode }) {
  return <SafeAreaView style={s.screen}><StatusBar style="dark" />{children}</SafeAreaView>;
}

export function WorldHeader({ title, subtitle, onSubtitle, back, right }: { title: string; subtitle?: string; onSubtitle?: () => void; back?: boolean; right?: ReactNode }) {
  const router = useRouter();
  return (
    <View style={s.header}>
      {back ? <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.iconBtn} onPress={() => (router.canGoBack() ? router.back() : router.replace("/countrylinqa/world"))}><Ionicons name="chevron-back" size={26} color={world.text} /></Pressable> : null}
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={s.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Pressable accessibilityRole={onSubtitle ? "button" : undefined} disabled={!onSubtitle} onPress={onSubtitle}><Text style={s.subtitle}>{subtitle}{onSubtitle ? " ⌄" : ""}</Text></Pressable> : null}
      </View>
      {right}
    </View>
  );
}

export function IconBtn({ icon, label, onPress, dot }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; dot?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={s.iconBtn} onPress={onPress}>
      <Ionicons name={icon} size={23} color={world.purple} />
      {dot ? <View style={s.dot} /> : null}
    </Pressable>
  );
}

export function VerifiedBadge() {
  return <Ionicons name="checkmark-circle" size={17} color={world.ok} accessibilityLabel="Verified" />;
}

export function Chip({ label, onPress, selected }: { label: string; onPress?: () => void; selected?: boolean }) {
  return (
    <Pressable accessibilityRole={onPress ? "button" : undefined} disabled={!onPress} onPress={onPress} style={[s.chip, selected && { backgroundColor: world.purple }]}>
      <Text style={[s.chipText, selected && { color: "#FFFFFF" }]}>{label}</Text>
    </Pressable>
  );
}

export function Empty({ icon, title, text, action }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={s.empty}>
      <Ionicons name={icon} size={40} color={world.faint} />
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyText}>{text}</Text>
      {action ? <Pressable accessibilityRole="button" style={s.emptyBtn} onPress={action.onPress}><Text style={s.emptyBtnText}>{action.label}</Text></Pressable> : null}
    </View>
  );
}

export function Spinner() {
  return <ActivityIndicator color={world.purple} style={{ marginTop: 28 }} />;
}

/**
 * Message button logic shared by every screen that lists people. It opens the Chat Access Result
 * screen, which runs the CountryLinqa access check and then either opens the chat or says why not.
 */
export function useMessage(_onOpen?: (conversationId: string) => void) {
  const router = useRouter();
  const message = useCallback((userId: string, name?: string) => {
    router.push({ pathname: "/countrylinqa/chat-access", params: { userId, ...(name ? { name } : {}) } });
  }, [router]);
  return { message, busy: null as string | null, error: null as string | null, clear: () => undefined };
}

export function PersonRow({ person, onOpen, onMessage, messaging, action }: { person: PersonDetail; onOpen: () => void; onMessage?: () => void; messaging?: boolean; action?: { label: string; onPress: () => void } }) {
  const line = headline(person);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${person.displayName}${person.verified ? ", verified" : ""}. ${locationLine(person)}. ${line}`} style={s.row} onPress={onOpen}>
      <Avatar name={person.displayName} size={56} />
      <View style={{ flex: 1 }}>
        <View style={s.nameLine}><Text style={s.name} numberOfLines={1}>{person.displayName}</Text>{person.verified ? <VerifiedBadge /> : null}</View>
        {locationLine(person) ? <Text style={s.meta} numberOfLines={1}>{locationLine(person)}</Text> : null}
        {line ? <Text style={s.meta} numberOfLines={1}>{line}</Text> : null}
      </View>
      {onMessage ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Message ${person.displayName}`} accessibilityState={{ disabled: !!messaging }} disabled={!!messaging} style={s.msgBtn} onPress={onMessage}>
          <Text style={s.msgText}>{messaging ? "…" : "Message"}</Text>
        </Pressable>
      ) : action ? (
        <Pressable accessibilityRole="button" style={s.msgBtn} onPress={action.onPress}><Text style={s.msgText}>{action.label}</Text></Pressable>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, minHeight: 56 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: world.text, fontFamily: fonts.extrabold, fontSize: 22 },
  subtitle: { color: world.muted, fontFamily: fonts.regular, fontSize: 14, marginTop: 1 },
  dot: { position: "absolute", top: 9, right: 10, width: 9, height: 9, borderRadius: 5, backgroundColor: "#F04438" },
  chip: { paddingHorizontal: 14, minHeight: 36, borderRadius: 18, backgroundColor: world.chip, alignItems: "center", justifyContent: "center" },
  chipText: { color: world.purple, fontFamily: fonts.medium, fontSize: 14 },
  empty: { alignItems: "center", paddingTop: 54, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { color: world.text, fontFamily: fonts.bold, fontSize: 17, marginTop: 6 },
  emptyText: { color: world.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: "center" },
  emptyBtn: { marginTop: 8, minHeight: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: world.soft, alignItems: "center", justifyContent: "center" },
  emptyBtnText: { color: world.purple, fontFamily: fonts.bold, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: world.border, minHeight: 84 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { color: world.text, fontFamily: fonts.bold, fontSize: 16, flexShrink: 1 },
  meta: { color: world.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 3 },
  msgBtn: { minWidth: 82, minHeight: 36, paddingHorizontal: 12, borderRadius: 9, backgroundColor: world.purple, alignItems: "center", justifyContent: "center" },
  msgText: { color: "#FFFFFF", fontFamily: fonts.semibold, fontSize: 13 }
});
