import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Card, FileIcon, FolderIcon, IconButton, Loading, Notice, VaultHeader, VaultScreen, useVaultData, vault } from "../../components/vault/ui";
import { formatBytes, groupByType, isPrivateType, itemTitle, newestFirst, relativeDay, typeLabel, type ItemType } from "../../services/vault-view";
import { fonts } from "../../theme/tokens";
import { getApiBaseUrl } from "../../config/api";
import { accessTokenProvider } from "../../services/session";
import { VaultService, type VaultObject } from "../../services/vault.service";

/**
 * My Files. Names and folders are encrypted on the device, so "folders" here are the item types
 * (Documents, Photos, ...) and files show their type and short id. Items of private types are
 * listed only inside the Private Vault.
 */
export default function VaultFiles() {
  const router = useRouter();
  const { items, error, reload } = useVaultData();
  // Files saved from outside (Social, Messages ...) are stored apart from the original items.
  const imports = useMemo(() => new VaultService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()), []);
  const [saved, setSaved] = useState<VaultObject[]>([]);
  useEffect(() => {
    let active = true;
    imports.files().then((result) => { if (active) setSaved(result.items); }, () => undefined);
    return () => { active = false; };
  }, [imports]);
  const [type, setType] = useState<ItemType | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => (items ?? []).filter((i) => !isPrivateType(i.item_type)), [items]);
  const groups = useMemo(() => groupByType(visible), [visible]);
  const files = useMemo(() => {
    const q = query.trim().toLowerCase();
    return newestFirst(visible).filter((i) => (!type || i.item_type === type) && (!q || itemTitle(i).toLowerCase().includes(q)));
  }, [visible, type, query]);

  return (
    <VaultScreen tab="files">
      <VaultHeader
        title="My Files"
        right={
          <View style={{ flexDirection: "row" }}>
            <IconButton icon={searching ? "close" : "search"} label={searching ? "Close search" : "Search"} onPress={() => { setSearching((v) => !v); setQuery(""); }} />
            <IconButton icon="add-circle-outline" label="Add to vault" onPress={() => router.push("/vault/intake")} />
          </View>
        }
      />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {searching ? <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Search by type or id" placeholderTextColor={vault.faint} style={s.search} accessibilityLabel="Search files" /> : null}
        {error ? <View style={{ marginBottom: 14 }}><Notice tone="warn" text={error} action={{ label: "Try again", onPress: reload }} /></View> : null}
        {items === null ? <Loading /> : null}

        {items && groups.length > 0 ? (
          <>
            <Text style={s.section}>All Folders</Text>
            <Card style={{ paddingHorizontal: 14 }}>
              {groups.map((g, index) => (
                <Pressable key={g.type} accessibilityRole="button" accessibilityState={{ selected: type === g.type }} accessibilityLabel={`${g.label}, ${g.count} items`} style={[s.row, index > 0 && s.border]} onPress={() => setType(type === g.type ? null : g.type)}>
                  <FolderIcon />
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{g.label}</Text>
                    <Text style={s.meta}>{g.count} {g.count === 1 ? "item" : "items"}</Text>
                  </View>
                  <Text style={s.when}>{relativeDay(g.latest)}</Text>
                  <Ionicons name={type === g.type ? "checkmark-circle" : "chevron-forward"} size={18} color={type === g.type ? vault.blueText : vault.faint} />
                </Pressable>
              ))}
            </Card>
          </>
        ) : null}

        {saved.length > 0 ? (
          <>
            <Text style={s.section}>Saved from Social and other sources</Text>
            <Card style={{ paddingHorizontal: 14 }}>
              {saved.map((object, index) => (
                <Pressable key={object.id} accessibilityRole="button" accessibilityLabel={`Encrypted file, ${formatBytes(object.sizeBytes)}, share`} style={[s.row, index > 0 && s.border]} onPress={() => router.push({ pathname: "/vault/share", params: { id: object.id } })}>
                  <FileIcon type="DOCUMENT" />
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>Encrypted file</Text>
                    <Text style={s.meta}>{formatBytes(object.sizeBytes)} • {relativeDay(object.createdAt)}{object.tags.length ? ` • ${object.tags.join(", ")}` : ""}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={vault.faint} />
                </Pressable>
              ))}
            </Card>
          </>
        ) : null}

        {items ? (
          <>
            <View style={s.between}>
              <Text style={s.section}>{type ? `Files · ${groups.find((g) => g.type === type)?.label ?? ""}` : "Files"}</Text>
              {type ? <Pressable accessibilityRole="button" onPress={() => setType(null)}><Text style={s.clear}>Show all</Text></Pressable> : null}
            </View>
            {files.length === 0 ? (
              <Card style={{ padding: 18 }}><Text style={s.meta}>{visible.length === 0 ? "No files yet. Use the + button to add one." : "No files match."}</Text></Card>
            ) : (
              <Card style={{ paddingHorizontal: 14 }}>
                {files.map((item, index) => (
                  <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${itemTitle(item)}, open sharing`} style={[s.row, index > 0 && s.border]} onPress={() => router.push("/vault/share")}>
                    <FileIcon type={item.item_type} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.name} numberOfLines={1}>{itemTitle(item)}</Text>
                      <Text style={s.meta}>{formatBytes(item.encrypted_size)} • {relativeDay(item.created_at)} • {typeLabel(item.item_type)}</Text>
                    </View>
                    <Ionicons name="ellipsis-vertical" size={18} color={vault.faint} />
                  </Pressable>
                ))}
              </Card>
            )}
          </>
        ) : null}
      </ScrollView>
    </VaultScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 28 },
  search: { height: 46, borderRadius: 14, borderWidth: 1, borderColor: vault.border, backgroundColor: vault.card, color: vault.text, paddingHorizontal: 14, fontFamily: fonts.regular, fontSize: 15, marginBottom: 6 },
  section: { color: vault.text, fontFamily: fonts.semibold, fontSize: 14, marginTop: 18, marginBottom: 10 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  clear: { color: vault.blueText, fontFamily: fonts.semibold, fontSize: 13, marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, minHeight: 62 },
  border: { borderTopWidth: 1, borderTopColor: vault.border },
  name: { color: vault.text, fontFamily: fonts.semibold, fontSize: 15 },
  meta: { color: vault.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 },
  when: { color: vault.faint, fontFamily: fonts.regular, fontSize: 11 }
});
