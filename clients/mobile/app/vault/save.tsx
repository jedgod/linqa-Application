import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Card, FileIcon, Notice, PrimaryButton, VaultHeader, VaultScreen, vault } from "../../components/vault/ui";
import { getApiBaseUrl } from "../../config/api";
import { accessTokenProvider } from "../../services/session";
import { VaultService } from "../../services/vault.service";
import { failureText } from "../../services/vault-view";
import { fonts } from "../../theme/tokens";

/**
 * Save to Vault: the last step. The scanned file waits in quarantine on the server as plaintext.
 * It may enter the Vault only as ciphertext this device encrypts and uploads, so Save Now stays off
 * in a build that has no on-device vault encryption. "File is safe" appears only after the server
 * confirms this import passed its scan.
 */
export default function VaultSaveToVault() {
  const router = useRouter();
  const params = useLocalSearchParams<{ importId?: string; file?: string; size?: string; folderPath?: string }>();
  const client = useMemo(() => new VaultService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()), []);
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => {
    if (!params.importId) return;
    let active = true;
    client.importStatus(params.importId).then(
      (status) => { if (active) setVerified(status.state === "AWAITING_CONFIRMATION" || status.state === "COMPLETED" || status.state === "VAULTED"); },
      () => { if (active) setVerified(false); }
    );
    return () => { active = false; };
  }, [client, params.importId]);

  const safe = !!params.importId && verified === true;
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/vault"));

  return (
    <VaultScreen tab="files" tabs={false}>
      <VaultHeader title="" back />
      <ScrollView contentContainerStyle={s.content}>
        <View style={[s.badge, safe ? { borderColor: vault.green, backgroundColor: "#0F2E1C" } : { borderColor: vault.faint, backgroundColor: "#14202E" }]}>
          <Ionicons name={safe ? "checkmark" : "help"} size={48} color={safe ? vault.green : vault.muted} />
        </View>
        <Text style={s.title}>{safe ? "File is safe!" : verified === null && params.importId ? "One moment" : "Nothing to save yet"}</Text>
        <Text style={s.sub}>{safe ? "It passed its security scan." : verified === null && params.importId ? "Checking this file…" : "A file has to pass its security scan before it can be saved."}</Text>

        {params.importId ? (
          <Card style={s.file}>
            <FileIcon type="DOCUMENT" />
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>{params.file}</Text>
              <Text style={s.sub2}>{[params.size, params.folderPath].filter(Boolean).join(" · ")}</Text>
            </View>
          </Card>
        ) : null}

        {safe ? (
          <View style={{ marginTop: 4 }}>
            <Notice tone="warn" text={failureText("CLIENT_ENCRYPTION_REQUIRED")} />
            <Text style={s.fine}>The clean copy is deleted from quarantine automatically if it is not saved within two hours.</Text>
          </View>
        ) : null}
        <View style={{ marginTop: 22 }}><PrimaryButton label="Save Now" disabled onPress={() => undefined} /></View>
        <Pressable accessibilityRole="button" style={s.cancel} onPress={leave}><Text style={s.cancelText}>Cancel</Text></Pressable>
      </ScrollView>
    </VaultScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 28 },
  badge: { alignSelf: "center", width: 96, height: 96, borderRadius: 48, borderWidth: 4, alignItems: "center", justifyContent: "center" },
  title: { color: vault.text, fontFamily: fonts.semibold, fontSize: 21, textAlign: "center", marginTop: 18 },
  sub: { color: vault.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: "center", marginTop: 6 },
  file: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, marginVertical: 22 },
  name: { color: vault.text, fontFamily: fonts.semibold, fontSize: 15 },
  sub2: { color: vault.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 },
  fine: { color: vault.faint, fontFamily: fonts.regular, fontSize: 12, marginTop: 10, textAlign: "center" },
  cancel: { alignItems: "center", justifyContent: "center", minHeight: 48, marginTop: 10 },
  cancelText: { color: vault.blueText, fontFamily: fonts.semibold, fontSize: 15 }
});
