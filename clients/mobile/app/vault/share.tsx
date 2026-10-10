import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Share as NativeShare, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Badge, Card, FileIcon, Loading, Notice, PrimaryButton, Tile, VaultHeader, VaultScreen, vault } from "../../components/vault/ui";
import { getApiBaseUrl } from "../../config/api";
import { accessTokenProvider } from "../../services/session";
import { VaultService, type VaultCapabilities, type VaultObject } from "../../services/vault.service";
import { failureText, formatBytes, relativeDay } from "../../services/vault-view";
import { fonts } from "../../theme/tokens";

type Mode = "linqa-user" | "secure-link" | "email" | "social" | null;
const EXPIRIES: Array<[string, number]> = [["1 hour", 60], ["1 day", 1440], ["7 days", 10080]];

function errorText(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : "";
  return failureText(code) !== "This file could not be saved." ? failureText(code) : "Something went wrong. Nothing was shared.";
}

/**
 * Share. Lists files saved to the vault, then the ways to share one. Each option is on only when the
 * server says its provider is connected. Links carry a random token, never the file's storage
 * address, and sharing to Social always makes a copy.
 */
export default function VaultShare() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const client = useMemo(() => new VaultService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()), []);
  const [objects, setObjects] = useState<VaultObject[] | null>(null);
  const [caps, setCaps] = useState<VaultCapabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [expiry, setExpiry] = useState(1440);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ message: string; url?: string; linkId?: string } | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    Promise.all([client.files(), client.capabilities()]).then(
      ([files, capabilities]) => { if (active) { setObjects(files.items); setCaps(capabilities); setError(null); } },
      (cause) => { if (active) { setObjects((current) => current ?? []); setError(errorText(cause)); } }
    );
    return () => { active = false; };
  }, [client]));

  const item = id ? objects?.find((o) => o.id === id) : undefined;

  async function submit() {
    if (!item || busy) return;
    setBusy(true);
    setResult(null);
    try {
      if (mode === "secure-link") {
        const link = await client.createSecureLink(item.id, expiry);
        setResult({ message: "Link created. It is shown once, so copy or share it now.", url: link.url, linkId: link.linkId });
      } else if (mode === "email") {
        await client.shareByEmail(item.id, text.trim(), expiry);
        setResult({ message: `A secure link was emailed to ${text.trim()}.` });
      } else if (mode === "linqa-user") {
        await client.shareWithLinqaUser(item.id, text.trim());
        setResult({ message: "Sent. They can open it after they accept." });
      }
    } catch (cause) {
      setResult({ message: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }

  const options: Array<{ key: Exclude<Mode, null>; icon: keyof typeof Ionicons.glyphMap; color: string; title: string; subtitle: string; on: boolean }> = [
    { key: "linqa-user", icon: "person", color: "#2563EB", title: "Linqa User", subtitle: "Share securely with a Linqa user", on: !!caps?.sharing },
    { key: "secure-link", icon: "link", color: "#7C3AED", title: "Secure Link", subtitle: "Create a secure share link", on: !!caps?.sharing },
    { key: "email", icon: "mail", color: "#2563EB", title: "Email", subtitle: "Send via email", on: !!caps?.email },
    { key: "social", icon: "share-social", color: "#7C3AED", title: "Export to Social (Copy)", subtitle: "Share a copy to Linqa Social", on: false }
  ];

  return (
    <VaultScreen tab="share">
      <VaultHeader title="Share" back={!!id} />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {error ? <View style={{ marginBottom: 14 }}><Notice tone="warn" text={error} /></View> : null}
        {objects === null ? <Loading /> : null}

        {objects && !item ? (
          <>
            <Text style={s.section}>Choose a file to share</Text>
            {objects.length === 0 ? (
              <Card style={{ padding: 18 }}><Text style={s.meta}>No files saved to your vault yet. Files you save from Linqa Social will appear here.</Text></Card>
            ) : (
              <Card style={{ paddingHorizontal: 14 }}>
                {objects.map((entry, index) => (
                  <Pressable key={entry.id} accessibilityRole="button" accessibilityLabel={`Share file saved ${relativeDay(entry.createdAt)}`} style={[s.file, index > 0 && s.border]} onPress={() => router.setParams({ id: entry.id })}>
                    <FileIcon type="DOCUMENT" />
                    <View style={{ flex: 1 }}>
                      <Text style={s.name}>Encrypted file</Text>
                      <Text style={s.meta}>{formatBytes(entry.sizeBytes)} • {relativeDay(entry.createdAt)}{entry.tags.length ? ` • ${entry.tags.join(", ")}` : ""}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={vault.faint} />
                  </Pressable>
                ))}
              </Card>
            )}
          </>
        ) : null}

        {item ? (
          <>
            <Card style={s.selected}>
              <FileIcon type="DOCUMENT" />
              <View style={{ flex: 1 }}>
                <Text style={s.name}>Encrypted file</Text>
                <Text style={s.meta}>{formatBytes(item.sizeBytes)}{item.tags.length ? ` • ${item.tags.join(", ")}` : ""}</Text>
              </View>
            </Card>
            <Text style={s.section}>Share to</Text>
            {options.map((option) => (
              <Tile key={option.key} icon={option.icon} color={option.color} title={option.title} subtitle={option.subtitle} disabled={!option.on}
                trailing={option.on ? undefined : <Badge text="Not available" tone="off" />}
                onPress={() => { setResult(null); setText(""); if (option.on) setMode(option.key); else setResult({ message: option.key === "social" ? "Sharing to Social needs an approval on this device, which is not available in this version. Nothing was shared." : `${option.title} is not available yet. Nothing was shared.` }); }} />
            ))}

            {mode ? (
              <Card style={{ padding: 16, marginTop: 4 }}>
                {mode === "linqa-user" || mode === "email" ? (
                  <TextInput value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} keyboardType={mode === "email" ? "email-address" : "default"}
                    placeholder={mode === "email" ? "Email address" : "Linqa username"} placeholderTextColor={vault.faint} style={s.input} accessibilityLabel={mode === "email" ? "Email address" : "Linqa username"} />
                ) : null}
                {mode === "secure-link" || mode === "email" ? (
                  <View style={s.chips} accessibilityRole="radiogroup">
                    {EXPIRIES.map(([label, minutes]) => (
                      <Pressable key={minutes} accessibilityRole="radio" accessibilityState={{ selected: expiry === minutes }} style={[s.chip, expiry === minutes && s.chipOn]} onPress={() => setExpiry(minutes)}>
                        <Text style={[s.chipText, expiry === minutes && { color: "#FFFFFF" }]}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <View style={{ marginTop: 14 }}>
                  <PrimaryButton label={busy ? "Working…" : mode === "secure-link" ? "Create link" : mode === "email" ? "Send email" : "Send"} disabled={busy || ((mode === "email" || mode === "linqa-user") && text.trim().length < 3)} onPress={() => void submit()} />
                </View>
              </Card>
            ) : null}

            {result ? (
              <View style={{ marginTop: 14 }}>
                <Notice tone={result.url || /sent|emailed|created/i.test(result.message) ? "info" : "warn"} text={result.message} />
                {result.url ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={s.url} selectable>{result.url}</Text>
                    <Pressable accessibilityRole="button" style={s.copy} onPress={() => void NativeShare.share({ message: result.url! })}><Text style={s.copyText}>Share link</Text></Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}
            <Text style={s.fine}>Sharing to Social creates a copy. The original stays private in your vault.</Text>
          </>
        ) : null}

        {objects && id && !item ? <Notice tone="warn" text="That file could not be found in your vault." /> : null}
      </ScrollView>
    </VaultScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28 },
  section: { color: vault.text, fontFamily: fonts.semibold, fontSize: 15, marginTop: 20, marginBottom: 12 },
  selected: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, marginTop: 8 },
  file: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, minHeight: 62 },
  border: { borderTopWidth: 1, borderTopColor: vault.border },
  name: { color: vault.text, fontFamily: fonts.semibold, fontSize: 15 },
  meta: { color: vault.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 },
  input: { height: 48, borderRadius: 12, borderWidth: 1, borderColor: vault.border, backgroundColor: "#0A1827", color: vault.text, paddingHorizontal: 14, fontFamily: fonts.regular, fontSize: 15 },
  chips: { flexDirection: "row", gap: 8, marginTop: 12 },
  chip: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: vault.border, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: vault.blue, borderColor: vault.blue },
  chipText: { color: vault.text, fontFamily: fonts.medium, fontSize: 13 },
  url: { color: vault.blueText, fontFamily: fonts.regular, fontSize: 12 },
  copy: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  copyText: { color: vault.blueText, fontFamily: fonts.semibold, fontSize: 14 },
  fine: { color: vault.faint, fontFamily: fonts.regular, fontSize: 12, textAlign: "center", marginTop: 12 }
});
