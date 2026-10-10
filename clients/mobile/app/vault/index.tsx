import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAccounts } from "../../account/AccountContext";
import { Card, FileIcon, IconButton, Loading, Notice, ProgressBar, VaultScreen, useVaultData, vault } from "../../components/vault/ui";
import { formatBytes, isPrivateType, itemTitle, newestFirst, relativeDay, totalBytes, typeLabel } from "../../services/vault-view";
import { fonts } from "../../theme/tokens";

/** Linqa Vault home: how much is stored, quick actions, and the newest items. */
export default function VaultHome() {
  const router = useRouter();
  const { active } = useAccounts();
  const { items, status, error, reload } = useVaultData();
  const first = (active?.displayName ?? "").trim().split(/\s+/)[0] ?? "";
  const recent = items ? newestFirst(items.filter((i) => !isPrivateType(i.item_type))).slice(0, 3) : [];
  const actions: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string; color: string; route: string }> = [
    { icon: "cloud-upload-outline", label: "Upload\nFiles", color: vault.blueText, route: "/vault/intake" },
    { icon: "download-outline", label: "Intake\nCenter", color: vault.green, route: "/vault/intake" },
    { icon: "share-social-outline", label: "Secure\nShare", color: vault.blueText, route: "/vault/share" },
    { icon: "lock-closed-outline", label: "Private\nVault", color: vault.amber, route: "/vault/private" }
  ];

  return (
    <VaultScreen tab="home">
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.top}>
          <View style={s.logo}><Ionicons name="lock-closed" size={20} color={vault.blueText} /></View>
          <Text style={s.brand}>Linqa Vault</Text>
          <IconButton icon="close" label="Close vault" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home" as never))} />
        </View>

        <Text style={s.hello}>{first ? `Hello, ${first} 👋` : "Hello 👋"}</Text>
        <Text style={s.sub}>Your secure digital vault</Text>

        {error ? <View style={{ marginTop: 16 }}><Notice tone="warn" text={error} action={{ label: "Try again", onPress: reload }} /></View> : null}

        <Card style={s.storage}>
          <Text style={s.label}>Storage used</Text>
          {items ? (
            <>
              <Text style={s.big}>{formatBytes(totalBytes(items))}</Text>
              <View style={{ marginTop: 14 }}><ProgressBar value={items.length ? 100 : 0} /></View>
              <Text style={s.fine}>{items.length} encrypted {items.length === 1 ? "item" : "items"} · {status?.quotaMetering ? "quota tracked" : "no storage limit applied yet"}</Text>
            </>
          ) : <Loading />}
          <Pressable accessibilityRole="button" onPress={() => router.push("/vault/plans")}><Text style={s.upgrade}>Storage plans</Text></Pressable>
        </Card>

        <Text style={s.section}>Quick Actions</Text>
        <View style={s.grid}>
          {actions.map((a) => (
            <Pressable key={a.label} accessibilityRole="button" accessibilityLabel={a.label.replace("\n", " ")} style={s.quick} onPress={() => router.push(a.route as never)}>
              <Ionicons name={a.icon} size={24} color={a.color} />
              <Text style={s.quickText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.rowBetween}>
          <Text style={s.section}>Recent Files</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push("/vault/files")}><Text style={s.seeAll}>See All</Text></Pressable>
        </View>
        {items === null ? <Loading /> : recent.length === 0 ? (
          <Card style={{ padding: 18 }}><Text style={s.empty}>No files in your vault yet. Use the + button to add one.</Text></Card>
        ) : (
          <Card style={{ paddingHorizontal: 14 }}>
            {recent.map((item, index) => (
              <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${itemTitle(item)}, open sharing`} style={[s.file, index > 0 && s.fileBorder]} onPress={() => router.push("/vault/share")}>
                <FileIcon type={item.item_type} />
                <View style={{ flex: 1 }}>
                  <Text style={s.fileName} numberOfLines={1}>{itemTitle(item)}</Text>
                  <Text style={s.fileMeta}>{formatBytes(item.encrypted_size)} • {relativeDay(item.created_at)} • {typeLabel(item.item_type)}</Text>
                </View>
                <Ionicons name="ellipsis-vertical" size={18} color={vault.faint} />
              </Pressable>
            ))}
          </Card>
        )}
      </ScrollView>
    </VaultScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 28 },
  top: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 10 },
  logo: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#12306A", alignItems: "center", justifyContent: "center" },
  brand: { flex: 1, color: vault.text, fontFamily: fonts.semibold, fontSize: 21 },
  hello: { color: vault.text, fontFamily: fonts.semibold, fontSize: 22, marginTop: 22 },
  sub: { color: vault.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 4 },
  storage: { padding: 18, marginTop: 20 },
  label: { color: vault.muted, fontFamily: fonts.medium, fontSize: 13 },
  big: { color: vault.text, fontFamily: fonts.extrabold, fontSize: 32, marginTop: 6 },
  fine: { color: vault.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 10 },
  upgrade: { color: vault.blueText, fontFamily: fonts.semibold, fontSize: 13, textAlign: "right", marginTop: 8 },
  section: { color: vault.text, fontFamily: fonts.semibold, fontSize: 16, marginTop: 24, marginBottom: 12 },
  grid: { flexDirection: "row", gap: 10 },
  quick: { flex: 1, minHeight: 88, backgroundColor: vault.card, borderWidth: 1, borderColor: vault.border, borderRadius: 16, alignItems: "center", justifyContent: "center", paddingVertical: 12, gap: 8 },
  quickText: { color: vault.text, fontFamily: fonts.medium, fontSize: 11, textAlign: "center", lineHeight: 15 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  seeAll: { color: vault.blueText, fontFamily: fonts.semibold, fontSize: 14, marginTop: 12 },
  empty: { color: vault.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  file: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, minHeight: 64 },
  fileBorder: { borderTopWidth: 1, borderTopColor: vault.border },
  fileName: { color: vault.text, fontFamily: fonts.semibold, fontSize: 15 },
  fileMeta: { color: vault.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 }
});
