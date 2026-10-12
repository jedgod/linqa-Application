import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAccounts } from "../../account/AccountContext";

const SECTIONS = [
  {
    title: "Account",
    items: [
      { title: "Account", copy: "Profile and account switching", icon: "person-circle-outline", color: "#5B4CFF", route: "/account/settings" },
      { title: "Privacy center", copy: "Audience, data and visibility controls", icon: "eye-off-outline", color: "#4F6EF7", route: "/privacy-center" },
      { title: "Security", copy: "Devices, encryption and session protection", icon: "shield-checkmark-outline", color: "#12A87D", route: "/modules/security" },
      { title: "Linked devices", copy: "Link Linqa Web on a computer by QR code", icon: "desktop-outline", color: "#5B4CFF", route: "/linked-devices" },
      { title: "Key transparency", copy: "Verify secure messaging identities", icon: "key-outline", color: "#0EA5A8", route: "/security/key-transparency" }
    ]
  },
  {
    title: "Preferences",
    items: [
      { title: "Notifications", copy: "Messages, calls and priority alerts", icon: "notifications-outline", color: "#E85D75", route: "/settings/notifications" },
      { title: "Messaging", copy: "Enter key sends and typing", icon: "chatbubble-ellipses-outline", color: "#5B4CFF", route: "/settings/messaging" },
      { title: "CountryLinqa", copy: "Country discovery and travel settings", icon: "globe-outline", color: "#7C5CE5", route: "/settings/countrylinqa" },
      { title: "AI & privacy", copy: "Choose where AI features may operate", icon: "sparkles-outline", color: "#A855F7", route: "/settings/ai-privacy" },
      { title: "Accessibility", copy: "Text, contrast and motion preferences", icon: "accessibility-outline", color: "#F59E0B", route: "/settings/accessibility" }
    ]
  },
  {
    title: "Data & support",
    items: [
      { title: "Storage", copy: "Downloads, media and local cache", icon: "server-outline", color: "#64748B", route: "/settings/storage" },
      { title: "Privacy rights", copy: "Export and account deletion requests", icon: "document-text-outline", color: "#2563EB", route: "/settings/privacy-rights" },
      { title: "Help & support", copy: "Guidance and secure support requests", icon: "help-buoy-outline", color: "#14B8A6", route: "/support" },
      { title: "About Linqa", copy: "Version, policies and product information", icon: "information-circle-outline", color: "#475569", route: "/modules/about" }
    ]
  }
] as const;

export default function SettingsScreen() {
  const router = useRouter();
  const { active } = useAccounts();
  const displayName = active?.displayName || active?.label || "Linqa account";
  const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();

  return (
    <SafeAreaView edges={["left", "right"]} style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.heading}>
          <Text style={s.eyebrow}>YOUR LINQA</Text>
          <Text style={s.title}>Settings</Text>
          <Text style={s.subtitle}>Account, privacy and app preferences in one place.</Text>
        </View>

        <Pressable style={s.profileCard} onPress={() => router.push("/account/manage")} accessibilityRole="button">
          <View style={s.avatar}><Text style={s.avatarText}>{initials || "LQ"}</Text></View>
          <View style={s.profileCopy}>
            <Text style={s.profileName}>{displayName}</Text>
            <Text style={s.profileMeta}>{active?.countryIso2 === "US" ? "United States" : active?.countryIso2 || "Verified Linqa account"}{active?.phoneSuffix ? `  •••• ${active.phoneSuffix}` : ""}</Text>
          </View>
          <View style={s.verified}><Ionicons name="checkmark-circle" size={17} color="#12805C" /><Text style={s.verifiedText}>Verified</Text></View>
        </Pressable>

        {SECTIONS.map((section) => (
          <View key={section.title} style={s.section}>
            <Text style={s.sectionTitle}>{section.title}</Text>
            <View style={s.card}>
              {section.items.map((item, index) => (
                <Pressable
                  key={item.title}
                  onPress={() => router.push(item.route as never)}
                  style={({ pressed }) => [s.row, index < section.items.length - 1 && s.divider, pressed && s.rowPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={item.title}
                >
                  <View style={[s.icon, { backgroundColor: `${item.color}14` }]}>
                    <Ionicons name={item.icon} size={21} color={item.color} />
                  </View>
                  <View style={s.rowCopy}>
                    <Text style={s.rowTitle}>{item.title}</Text>
                    <Text style={s.rowSubtitle}>{item.copy}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#A3A9B8" />
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <Text style={s.version}>Linqa mobile · Version 0.2.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F7FB" },
  content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 116 },
  heading: { marginBottom: 18 },
  eyebrow: { color: "#5B4CFF", fontSize: 12, fontWeight: "900", letterSpacing: 1.25 },
  title: { color: "#11142D", fontSize: 32, lineHeight: 38, fontWeight: "900", marginTop: 3 },
  subtitle: { color: "#686E85", fontSize: 13, lineHeight: 19, marginTop: 4 },
  profileCard: { minHeight: 84, borderRadius: 20, backgroundColor: "#151932", padding: 14, flexDirection: "row", alignItems: "center", shadowColor: "#11142D", shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  avatar: { width: 50, height: 50, borderRadius: 17, backgroundColor: "#5B4CFF", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  profileCopy: { flex: 1, marginLeft: 12 },
  profileName: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  profileMeta: { color: "#AEB4C8", fontSize: 12, marginTop: 4 },
  verified: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#DDF7EC", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  verifiedText: { color: "#12805C", fontSize: 9, fontWeight: "900" },
  section: { marginTop: 24 },
  sectionTitle: { color: "#34384F", fontSize: 12, fontWeight: "900", letterSpacing: 0.45, marginBottom: 9, marginLeft: 3, textTransform: "uppercase" },
  card: { borderRadius: 20, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7E9F1", overflow: "hidden" },
  row: { minHeight: 76, paddingHorizontal: 14, flexDirection: "row", alignItems: "center" },
  rowPressed: { backgroundColor: "#F3F4FA" },
  divider: { borderBottomWidth: 1, borderBottomColor: "#ECEEF4" },
  icon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, marginLeft: 12, marginRight: 8 },
  rowTitle: { color: "#1C2037", fontSize: 14, fontWeight: "800" },
  rowSubtitle: { color: "#74798E", fontSize: 12, lineHeight: 16, marginTop: 3 },
  version: { color: "#989DAE", fontSize: 12, textAlign: "center", marginTop: 26 }
});
