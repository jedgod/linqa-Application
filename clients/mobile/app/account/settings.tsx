import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAccounts } from "../../account/AccountContext";
import { avatarColorForSlot, fonts, radius, useTheme, type Palette } from "../../theme/tokens";

export default function AccountSettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { active } = useAccounts();
  const label = active?.label || active?.displayName || "Linqa account";
  const initials = label.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();

  const actions = [
    { title: "Switch Account", detail: "Choose another account on this device", icon: "swap-horizontal-outline" as const, route: "/account/switcher" },
    { title: "Manage Accounts", detail: "Add, review, or remove an account", icon: "people-outline" as const, route: "/account/manage" }
  ];

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.back}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text accessibilityRole="header" style={styles.headerTitle}>Account</Text>
          <View style={styles.back} />
        </View>

        <View style={styles.profile}>
          <View style={[styles.avatar, { backgroundColor: avatarColorForSlot(active?.slot ?? 1) }]}>
            <Text style={styles.avatarText}>{initials || "L"}</Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.profileName}>{label}</Text>
            <Text style={styles.profileDetail}>
              {active?.countryIso2 ? `${active.countryIso2} · ` : ""}
              {active?.phoneSuffix ? `•••• ${active.phoneSuffix}` : "Verified Linqa account"}
            </Text>
          </View>
          <Ionicons name="checkmark-circle" size={21} color="#12B76A" />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ACCOUNT SWITCHING</Text>
          <View style={styles.card}>
            {actions.map((item, index) => (
              <Pressable
                accessibilityRole="button"
                key={item.title}
                onPress={() => router.push(item.route as never)}
                style={({ pressed }) => [
                  styles.row,
                  index < actions.length - 1 && styles.divider,
                  pressed && styles.pressed
                ]}
              >
                <Ionicons name={item.icon} size={21} color={colors.accent} />
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.rowDetail}>{item.detail}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.info}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.accent} />
          <Text style={styles.infoText}>
            Switching requires an account already verified on this device. Linqa keeps each account&rsquo;s session and data separate.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 10, paddingBottom: 40 },
  header: { minHeight: 48, flexDirection: "row", alignItems: "center", marginBottom: 18 },
  back: { width: 40, height: 42, justifyContent: "center" },
  headerTitle: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 17, textAlign: "center" },
  profile: {
    minHeight: 86, flexDirection: "row", alignItems: "center", gap: 13, padding: 14,
    borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border
  },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontFamily: fonts.extrabold },
  profileCopy: { flex: 1 },
  profileName: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  profileDetail: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, marginTop: 4 },
  section: { marginTop: 28 },
  sectionTitle: { color: colors.textMuted, fontFamily: fonts.extrabold, fontSize: 11, letterSpacing: 0.8, marginBottom: 9, marginLeft: 3 },
  card: { overflow: "hidden", borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  row: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 15 },
  rowCopy: { flex: 1 },
  rowTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  rowDetail: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11, marginTop: 3 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pressed: { backgroundColor: colors.surfaceAlt },
  info: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 22, paddingHorizontal: 4 },
  infoText: { flex: 1, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 }
});
