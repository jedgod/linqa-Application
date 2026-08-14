import { useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, radius, spacing } from "../../theme/tokens";

type VaultScreen = "home" | "files" | "intake" | "save" | "private" | "share" | "plans" | "security";

type VaultItem = {
  id: string;
  name: string;
  size: string;
  type: "Document" | "Identity" | "Recovery" | "Photo";
};

const FILES: VaultItem[] = [
  { id: "1", name: "passport-copy.pdf", size: "2.2 MB", type: "Identity" },
  { id: "2", name: "insurance-card.png", size: "860 KB", type: "Document" },
  { id: "3", name: "legal-case-brief.pdf", size: "1.4 MB", type: "Document" },
  { id: "4", name: "backup-seed.txt", size: "44 KB", type: "Recovery" },
  { id: "5", name: "travel-photo.jpg", size: "980 KB", type: "Photo" }
];

const SOURCE_OPTIONS = [
  { icon: "chatbubble-ellipses-outline", label: "From Linqa Social", detail: "Save posts and attachments" },
  { icon: "mail-outline", label: "From Messages", detail: "Save message attachments" },
  { icon: "briefcase-outline", label: "From Client / Business", detail: "Save client files securely" },
  { icon: "phone-portrait-outline", label: "From Device", detail: "Upload from this device" },
  { icon: "link-outline", label: "From External Link", detail: "Secure link or shared file" },
  { icon: "scan-outline", label: "Scan Document", detail: "Scan and save to vault" }
] as const;

const SHARE_OPTIONS = [
  { icon: "person-outline", label: "Linqa User", detail: "Share securely with a Linqa user" },
  { icon: "swap-horizontal-outline", label: "Vault-to-Vault Transfer", detail: "Send directly to another vault" },
  { icon: "link-outline", label: "Secure Link", detail: "Create a secure share link" },
  { icon: "mail-outline", label: "Email", detail: "Send via email" },
  { icon: "share-social-outline", label: "Export to Social (Copy)", detail: "Share a copy to Linqa Social" }
] as const;

const STORAGE = [
  { label: "Current plan", value: "Linqa Plus" },
  { label: "Used", value: "6.5 GB / 20 GB" },
  { label: "Encrypted", value: "On-device before upload" }
];

function fileGlyph(type: VaultItem["type"]) {
  switch (type) {
    case "Identity":
      return "id-card-outline";
    case "Recovery":
      return "key-outline";
    case "Photo":
      return "image-outline";
    default:
      return "document-outline";
  }
}

function VaultHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack?: () => void }) {
  return (
    <View style={styles.headerRow}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.backButton} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color="#B7D0E6" />
        </Pressable>
      ) : <View style={styles.backButtonPlaceholder} />}
      <View style={styles.headerTextWrap}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

export default function FileVaultScreen() {
  const router = useRouter();
  const [screen, setScreen] = useState<VaultScreen>("home");
  const [selectedItem, setSelectedItem] = useState<VaultItem>(FILES[0]);
  const [folder, setFolder] = useState("Work Docs");
  const [tags, setTags] = useState(["client", "tax"]);
  const [pin, setPin] = useState("");
  const [privateUnlocked, setPrivateUnlocked] = useState(false);

  const recentItems = useMemo(() => FILES.slice(0, 4), []);

  const content = {
    home: (
      <View style={styles.screenBody}>
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <View>
              <Text style={styles.cardLabel}>Vault health</Text>
              <Text style={styles.heroTitle}>Secure storage</Text>
            </View>
            <Pressable onPress={() => setScreen("plans")} style={styles.heroAction}>
              <Text style={styles.heroActionText}>Upgrade</Text>
            </Pressable>
          </View>

          <View style={styles.storageTopRow}>
            <Text style={styles.storageValue}>6.5 GB</Text>
            <Text style={styles.storageMeta}> / 20 GB</Text>
            <Text style={styles.storagePct}>32%</Text>
          </View>
          <Text style={styles.heroSummary}>Encrypted and protected before upload.</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: "32%" }]} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickGrid}>
          <Pressable style={styles.quickButton} onPress={() => setScreen("save")}>
            <View style={styles.quickGlyphWrap}><Ionicons name="cloud-upload-outline" size={18} color={colors.accent} /></View>
            <Text style={styles.quickText}>Upload</Text>
          </Pressable>
          <Pressable style={styles.quickButton} onPress={() => setScreen("intake")}>
            <View style={styles.quickGlyphWrap}><Ionicons name="download-outline" size={18} color={colors.accent} /></View>
            <Text style={styles.quickText}>Intake</Text>
          </Pressable>
          <Pressable style={styles.quickButton} onPress={() => { setSelectedItem(FILES[2]); setScreen("share"); }}>
            <View style={styles.quickGlyphWrap}><Ionicons name="share-social-outline" size={18} color={colors.accent} /></View>
            <Text style={styles.quickText}>Share</Text>
          </Pressable>
          <Pressable style={styles.quickButton} onPress={() => setScreen("private")}>
            <View style={styles.quickGlyphWrap}><Ionicons name="lock-closed-outline" size={18} color={colors.accent} /></View>
            <Text style={styles.quickText}>Private</Text>
          </Pressable>
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Recent Files</Text>
          <Pressable onPress={() => setScreen("files")}>
            <Text style={styles.linkText}>See all</Text>
          </Pressable>
        </View>

        <View style={styles.listCard}>
          {recentItems.map((item) => (
            <Pressable key={item.id} style={styles.listRow} onPress={() => { setSelectedItem(item); setScreen("share"); }}>
              <View style={styles.listIconWrap}>
                <Ionicons name={fileGlyph(item.type)} size={18} color={colors.accent} />
              </View>
              <View style={styles.listBody}>
                <Text style={styles.listTitle}>{item.name}</Text>
                <Text style={styles.listMeta}>{item.size} · {item.type}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    ),
    files: (
      <View style={styles.screenBody}>
        <View style={styles.listCard}>
          {FILES.map((item) => (
            <View key={item.id} style={styles.listRow}>
              <View style={styles.listIconWrap}>
                <Ionicons name={fileGlyph(item.type)} size={18} color={colors.accent} />
              </View>
              <View style={styles.listBody}>
                <Text style={styles.listTitle}>{item.name}</Text>
                <Text style={styles.listMeta}>{item.size}</Text>
              </View>
              <Pressable onPress={() => { setSelectedItem(item); setScreen("share"); }}>
                <Text style={styles.inlineLink}>Share</Text>
              </Pressable>
            </View>
          ))}
        </View>
      </View>
    ),
    intake: (
      <View style={styles.screenBody}>
        <View style={styles.listCard}>
          {SOURCE_OPTIONS.map((source) => (
            <Pressable key={source.label} style={styles.listRow} onPress={() => source.label === "From Device" && setScreen("save")}>
              <View style={styles.listIconWrap}>
                <Ionicons name={source.icon as any} size={18} color={colors.accent} />
              </View>
              <View style={styles.listBody}>
                <Text style={styles.listTitle}>{source.label}</Text>
                <Text style={styles.listMeta}>{source.detail}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#7F9DB7" />
            </Pressable>
          ))}
        </View>
      </View>
    ),
    save: (
      <View style={styles.screenBody}>
        <View style={styles.listCard}>
          <View style={styles.listRowCompact}>
            <View style={styles.listIconWrap}>
              <Ionicons name="document-outline" size={18} color={colors.accent} />
            </View>
            <View style={styles.listBody}>
              <Text style={styles.listTitle}>client-brief.pdf</Text>
              <Text style={styles.listMeta}>2.1 MB</Text>
            </View>
          </View>
        </View>

        <Text style={styles.label}>Save to folder</Text>
        <TextInput value={folder} onChangeText={setFolder} style={styles.input} />

        <Text style={styles.label}>Tags</Text>
        <View style={styles.tagRow}>
          {tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
          <TextInput value="" placeholder="Add tag" style={styles.tagInput} />
        </View>

        <View style={styles.noticeBox}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.accent} />
          <Text style={styles.noticeText}>This file is encrypted on your device before it ever leaves it.</Text>
        </View>

        <Pressable style={styles.primaryButton} onPress={() => setScreen("home")}>
          <Text style={styles.primaryButtonText}>Save Now</Text>
        </Pressable>
      </View>
    ),
    private: (
      <View style={styles.screenBody}>
        {!privateUnlocked ? (
          <View style={styles.privateCard}>
            <View style={styles.privateIconWrap}>
              <Ionicons name="lock-closed-outline" size={32} color={colors.accent} />
            </View>
            <Text style={styles.privateTitle}>Enter your PIN</Text>
            <Text style={styles.privateCopy}>Unlock to access identity and recovery files.</Text>
            <TextInput
              value={pin}
              onChangeText={setPin}
              placeholder="••••"
              secureTextEntry
              keyboardType="number-pad"
              style={styles.input}
              maxLength={6}
            />
            <Pressable style={styles.primaryButton} onPress={() => { setPrivateUnlocked(true); setPin(""); }}>
              <Text style={styles.primaryButtonText}>Unlock</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.listCard}>
            {FILES.filter((item) => item.type === "Identity" || item.type === "Recovery").map((item) => (
              <View key={item.id} style={styles.listRow}>
                <View style={styles.listIconWrap}>
                  <Ionicons name={fileGlyph(item.type)} size={18} color={colors.accent} />
                </View>
                <View style={styles.listBody}>
                  <Text style={styles.listTitle}>{item.name}</Text>
                  <Text style={styles.listMeta}>{item.type}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    ),
    share: (
      <View style={styles.screenBody}>
        <View style={styles.listCard}>
          <View style={styles.listRowCompact}>
            <View style={styles.listIconWrap}>
              <Ionicons name={fileGlyph(selectedItem.type)} size={18} color={colors.accent} />
            </View>
            <View style={styles.listBody}>
              <Text style={styles.listTitle}>{selectedItem.name}</Text>
              <Text style={styles.listMeta}>{selectedItem.size}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Share to</Text>
        <View style={styles.listCard}>
          {SHARE_OPTIONS.map((share) => (
            <View key={share.label} style={styles.listRow}>
              <View style={styles.listIconWrap}>
                <Ionicons name={share.icon as any} size={18} color={colors.accent} />
              </View>
              <View style={styles.listBody}>
                <Text style={styles.listTitle}>{share.label}</Text>
                <Text style={styles.listMeta}>{share.detail}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    ),
    plans: (
      <View style={styles.screenBody}>
        <View style={styles.storageCard}>
          <Text style={styles.cardLabel}>Current Plan</Text>
          <Text style={styles.storageValue}>Linqa Plus</Text>
          <Text style={styles.listMeta}>6.5 GB used · 20 GB total</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: "32%" }]} />
          </View>
        </View>

        <View style={styles.planList}>
          {[
            { plan: "Starter", price: "$0" },
            { plan: "Plus", price: "$12/mo", active: true },
            { plan: "Business", price: "$29/mo" }
          ].map((row) => (
            <View key={row.plan} style={[styles.planItem, row.active && styles.planItemActive]}>
              <View style={styles.planDot} />
              <Text style={styles.planText}>{row.plan}</Text>
              <Text style={styles.planPrice}>{row.price}</Text>
            </View>
          ))}
        </View>
      </View>
    ),
    security: (
      <View style={styles.screenBody}>
        <View style={styles.securityBadge}>
          <Ionicons name="shield-checkmark-outline" size={22} color={colors.accent} />
          <Text style={styles.securityTitle}>Vault content is encrypted client-side</Text>
          <Text style={styles.listMeta}>Every file is encrypted before it leaves this device.</Text>
        </View>

        <View style={styles.listCard}>
          {STORAGE.map((row) => (
            <View key={row.label} style={styles.listRow}>
              <View style={styles.listBody}>
                <Text style={styles.listTitle}>{row.label}</Text>
              </View>
              <Text style={styles.statusPill}>{row.value}</Text>
            </View>
          ))}
        </View>
      </View>
    )
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>Linqa Vault</Text>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="close-outline" size={22} color="#DCE9F8" />
        </Pressable>
      </View>

      {screen === "home" ? (
        <View style={styles.content}>
          <VaultHeader title="Linqa Vault" subtitle="Secure storage" />
          {content.home}
          <View style={styles.bottomTabs}>
            {[
              { label: "Home", active: true },
              { label: "Files" },
              { label: "Security" }
            ].map((tab) => (
              <Pressable key={tab.label} style={[styles.bottomTab, tab.active && styles.bottomTabActive]} onPress={() => {
                if (tab.label === "Files") setScreen("files");
                if (tab.label === "Security") setScreen("security");
              }}>
                <Text style={[styles.bottomTabText, tab.active && styles.bottomTabTextActive]}>{tab.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.content}>
          <VaultHeader
            title={
              screen === "files" ? "My Files" :
              screen === "intake" ? "Intake Center" :
              screen === "save" ? "Save to Vault" :
              screen === "private" ? "Private Vault" :
              screen === "share" ? "Share" :
              screen === "plans" ? "Storage Plans" :
              "Security Center"
            }
            subtitle={screen === "intake" ? "Bring files into your secure vault" : undefined}
            onBack={() => setScreen("home")}
          />
          {content[screen]}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F3F7FB" },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  brand: { color: "#0F2330", fontSize: 18, fontWeight: "900" },
  content: { flex: 1, paddingHorizontal: 16, paddingBottom: 28 },
  screenBody: { gap: 14, paddingBottom: 24 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, marginBottom: 2 },
  backButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#E7F0F9", alignItems: "center", justifyContent: "center" },
  backButtonPlaceholder: { width: 32, height: 32 },
  headerTextWrap: { flex: 1 },
  headerTitle: { color: "#0F2330", fontSize: 24, fontWeight: "900", letterSpacing: -0.35 },
  headerSubtitle: { color: "#5B6E82", fontSize: 12, marginTop: 4 },
  heroCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E4ECF5",
    shadowColor: "#102033",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  storageCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E4ECF5",
    shadowColor: "#102033",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  heroHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  heroTitle: { color: "#0F2330", fontSize: 20, fontWeight: "900", letterSpacing: -0.3 },
  heroAction: { backgroundColor: "#EAF7F4", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  heroActionText: { color: colors.accent, fontSize: 11, fontWeight: "800" },
  cardLabel: { color: "#5C7388", fontSize: 11, fontWeight: "700", marginBottom: 6 },
  storageTopRow: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  storageValue: { color: "#0F2330", fontSize: 26, fontWeight: "900" },
  storageMeta: { color: "#6D8090", fontSize: 13, fontWeight: "600" },
  storagePct: { marginLeft: "auto", color: colors.accent, fontSize: 12, fontWeight: "800" },
  heroSummary: { color: "#586F8A", fontSize: 12, fontWeight: "600", marginTop: 8 },
  progressBar: { height: 8, backgroundColor: "#E9EEF6", borderRadius: 999, overflow: "hidden", marginTop: 14 },
  progressFill: { height: "100%", backgroundColor: colors.accent, borderRadius: 999 },
  linkButton: { marginTop: 12, alignSelf: "flex-start" },
  linkText: { color: colors.accent, fontWeight: "800" },
  sectionTitle: { color: "#0F2330", fontSize: 15, fontWeight: "800", letterSpacing: -0.12 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  quickButton: {
    width: "48%",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "#E4ECF5",
    alignItems: "center",
    gap: 7,
    shadowColor: "#102033",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  quickGlyphWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#EAF7F4", alignItems: "center", justifyContent: "center" },
  quickText: { color: "#0F2330", fontWeight: "800", fontSize: 11.5 },
  listCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E4ECF5",
    overflow: "hidden",
    shadowColor: "#102033",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 7 },
    elevation: 1,
  },
  listRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#EEF3F8" },
  listRowCompact: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  listIconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#EAF7F4", alignItems: "center", justifyContent: "center" },
  listBody: { flex: 1 },
  listTitle: { color: "#112433", fontWeight: "800", fontSize: 13 },
  listMeta: { color: "#6D8090", fontSize: 11, marginTop: 3 },
  inlineLink: { color: colors.accent, fontWeight: "800", fontSize: 12 },
  label: { color: "#42586E", fontSize: 11, fontWeight: "700", marginTop: 6 },
  input: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE6F1", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, color: "#102333", marginTop: 8, minHeight: 46 },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 },
  tag: { backgroundColor: "#EAF7F4", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  tagText: { color: "#0F2330", fontSize: 11, fontWeight: "700" },
  tagInput: { minWidth: 80, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE6F1", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  noticeBox: { backgroundColor: "#EAF7F4", borderRadius: 12, padding: 12, marginTop: 6, flexDirection: "row", gap: 8, alignItems: "center" },
  noticeText: { color: "#1A3E42", flex: 1, fontSize: 12, fontWeight: "700" },
  primaryButton: { backgroundColor: "#165DFF", borderRadius: 14, height: 46, justifyContent: "center", marginTop: 10 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 14.5, fontWeight: "900", textAlign: "center" },
  privateCard: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 18, borderWidth: 1, borderColor: "#E4ECF5", shadowColor: "#102033", shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 7 }, elevation: 1 },
  privateIconWrap: { width: 60, height: 60, borderRadius: 16, backgroundColor: "#EAF7F4", alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 12 },
  privateTitle: { color: "#0F2330", fontSize: 20, fontWeight: "900", textAlign: "center" },
  privateCopy: { color: "#5B6E82", textAlign: "center", marginTop: 8, marginBottom: 14 },
  planList: { backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E4ECF5", overflow: "hidden", shadowColor: "#102033", shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 7 }, elevation: 1 },
  planItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#EEF3F8" },
  planItemActive: { backgroundColor: "#F1F8FF" },
  planDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#CDD9EA" },
  planText: { flex: 1, color: "#112433", fontWeight: "700", fontSize: 13 },
  planPrice: { color: "#0F2330", fontWeight: "800", fontSize: 12 },
  securityBadge: { backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E4ECF5", padding: 14, alignItems: "center", shadowColor: "#102033", shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 7 }, elevation: 1 },
  securityTitle: { color: "#0F2330", fontSize: 16, fontWeight: "800", marginTop: 8, marginBottom: 4, textAlign: "center" },
  statusPill: { color: colors.accent, fontWeight: "800", fontSize: 11, backgroundColor: "#EAF7F4", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  bottomTabs: { position: "absolute", left: 18, right: 18, bottom: 12, backgroundColor: "#FFFFFF", borderRadius: 16, flexDirection: "row", borderWidth: 1, borderColor: "#E6EDF5", paddingHorizontal: 8, paddingVertical: 8 },
  bottomTab: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12 },
  bottomTabActive: { backgroundColor: "#EAF7F4" },
  bottomTabText: { color: "#6E8396", fontSize: 12, fontWeight: "700" },
  bottomTabTextActive: { color: colors.accent }
});
