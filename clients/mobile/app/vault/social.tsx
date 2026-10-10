import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FolderPicker, type FolderChoice } from "../../components/vault/FolderPicker";
import { Card, FileIcon, Notice, PrimaryButton, VaultHeader, VaultScreen, vault } from "../../components/vault/ui";
import { getApiBaseUrl } from "../../config/api";
import { accessTokenProvider } from "../../services/session";
import { VaultService } from "../../services/vault.service";
import { fonts } from "../../theme/tokens";

/**
 * Save from Social: review one attachment, pick where it goes and what to call it, then start the
 * import. Starting only asks the server to fetch, scan and quarantine the file; nothing enters the
 * vault until the user confirms on the Save to Vault screen.
 */
export default function VaultSaveFromSocial() {
  const router = useRouter();
  const params = useLocalSearchParams<{ attachmentId?: string; from?: string; text?: string; file?: string; size?: string; when?: string }>();
  const client = useMemo(() => new VaultService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()), []);
  const [folder, setFolder] = useState<FolderChoice>({ id: null, path: "My Vault" });
  const [filename, setFilename] = useState(params.file ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = !!params.attachmentId && filename.trim().length > 0;

  async function start() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const started = await client.startSocialImport(params.attachmentId!, folder.id ?? undefined);
      router.push({ pathname: "/vault/scan", params: { importId: started.importId, folderId: folder.id ?? "", folderPath: folder.path, name: filename.trim() } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to start the import.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <VaultScreen tab="files">
      <VaultHeader title="Save from Social" back />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {!params.attachmentId ? (
          <Card style={{ padding: 20 }}>
            <Text style={s.emptyTitle}>No attachment selected</Text>
            <Text style={s.muted}>Open an attachment in Linqa Social and choose Save to Vault to review it here.</Text>
          </Card>
        ) : (
          <>
            <Card style={{ padding: 16 }}>
              <View style={s.sender}>
                <View style={s.avatar}><Ionicons name="person" size={20} color={vault.text} /></View>
                <View>
                  <Text style={s.name}>{params.from || "Linqa Social"}</Text>
                  {params.when ? <Text style={s.muted}>{params.when}</Text> : null}
                </View>
              </View>
              {params.text ? <Text style={s.body}>{params.text}</Text> : null}
              <View style={s.attachment}>
                <FileIcon type="DOCUMENT" />
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{params.file || "Attachment"}</Text>
                  {params.size ? <Text style={s.muted}>{params.size}</Text> : null}
                </View>
              </View>
            </Card>

            <Card style={{ padding: 16, marginTop: 16 }}>
              <Text style={s.label}>Save to</Text>
              <FolderPicker value={folder} onChange={setFolder} />
              <Text style={[s.label, { marginTop: 18 }]}>File name</Text>
              <TextInput value={filename} onChangeText={setFilename} maxLength={255} autoCapitalize="none" style={s.input} placeholder="File name" placeholderTextColor={vault.faint} accessibilityLabel="File name" />
              <View style={{ marginTop: 16 }}><Notice text="By saving, you agree that Linqa checks this file for malware in a private, temporary quarantine before your device encrypts it. Linqa can see the file during that check, and the quarantine copy is deleted within two hours." /></View>
              {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
              <View style={{ marginTop: 16 }}><PrimaryButton label={busy ? "Starting…" : "Save to Vault"} disabled={!ready || busy} onPress={() => void start()} /></View>
            </Card>
          </>
        )}
      </ScrollView>
    </VaultScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  sender: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#334155", alignItems: "center", justifyContent: "center" },
  name: { color: vault.text, fontFamily: fonts.semibold, fontSize: 15 },
  muted: { color: vault.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: 2 },
  emptyTitle: { color: vault.text, fontFamily: fonts.semibold, fontSize: 16, marginBottom: 6 },
  body: { color: vault.text, fontFamily: fonts.regular, fontSize: 15, marginTop: 14 },
  attachment: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: vault.border, borderRadius: 14, padding: 12, marginTop: 14 },
  label: { color: vault.text, fontFamily: fonts.semibold, fontSize: 13, marginBottom: 8 },
  input: { height: 50, borderRadius: 14, borderWidth: 1, borderColor: vault.border, backgroundColor: "#0A1827", color: vault.text, paddingHorizontal: 14, fontFamily: fonts.regular, fontSize: 15 },
  error: { color: vault.amber, fontFamily: fonts.medium, fontSize: 13, marginTop: 12 }
});
