import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { Card, FileIcon, IconButton, Loading, Notice, VaultHeader, VaultScreen, vault } from "../../components/vault/ui";
import { biometricInfo, type BiometricInfo } from "../../services/biometric";
import { PRIVATE_AUTO_LOCK_MS, formatBytes, isPrivateType, itemTitle, newestFirst, relativeDay, typeLabel } from "../../services/vault-view";
import { fonts } from "../../theme/tokens";

import { useBiometricClient } from "../../services/biometric-session";
import type { VaultUnlockSession } from "../../services/biometric-client";
import type { EncryptedVaultItem } from "../../services/vault.service";

/**
 * Private Vault: identity and recovery items, behind biometric hardware signing and a server grant.
 * It locks again after five minutes and whenever the screen is left, and
 * nothing private is rendered while locked.
 */
export default function VaultPrivate() {
  const router = useRouter();
  const client = useBiometricClient();
  const [items, setItems] = useState<EncryptedVaultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<VaultUnlockSession | null>(null);
  const generation = useRef(0);
  const focused = useRef(false);
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [bio, setBio] = useState<BiometricInfo | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { void biometricInfo().then(setBio); }, []);

  const lock = useCallback(() => {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const previous = session.current; session.current = null;
    setUnlocked(false); setItems(null); setBusy(false);
    if (previous) void client.lockVault(previous).catch(() => undefined);
  }, [client]);
  useFocusEffect(useCallback(() => { focused.current = true; lock(); return () => { focused.current = false; lock(); }; }, [lock]));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => { if (state === "background" || (state !== "active" && session.current)) lock(); });
    return () => subscription.remove();
  }, [lock]);

  async function reload() {
    if (!session.current) return;
    const current = generation.current;
    try { const result = await client.privateItems<EncryptedVaultItem>(session.current); if (focused.current && current === generation.current) { setItems(result.items); setError(null); } }
    catch (cause) { if (current === generation.current) { lock(); setFailed(cause instanceof Error ? cause.message : "Private Vault session expired."); } }
  }
  async function unlock() {
    if (busy) return;
    setBusy(true); setFailed(null); setError(null);
    const current = generation.current;
    let granted: VaultUnlockSession | null = null;
    try {
      granted = await client.unlockVault();
      const result = await client.privateItems<EncryptedVaultItem>(granted);
      if (!focused.current || current !== generation.current || AppState.currentState !== "active") { void client.lockVault(granted).catch(() => undefined); return; }
      session.current = granted; setItems(result.items); setUnlocked(true);
      timer.current = setTimeout(lock, Math.min(PRIVATE_AUTO_LOCK_MS, Math.max(0, new Date(granted.expiresAt).getTime()-Date.now())));
    } catch (cause) {
      if (granted) void client.lockVault(granted).catch(() => undefined);
      if (focused.current && current === generation.current) setFailed(cause instanceof Error ? cause.message.replace(/_/g," ") : "Unable to unlock Private Vault.");
    } finally { if (current === generation.current) setBusy(false); }
  }

  const privateItems = newestFirst((items ?? []).filter((i) => isPrivateType(i.item_type)));

  return (
    <VaultScreen tabs={false}>
      <VaultHeader title="Private Vault" back right={unlocked ? <IconButton icon="lock-closed-outline" label="Lock now" onPress={lock} /> : <IconButton icon="information-circle-outline" label="About the private vault" onPress={() => setFailed("Identity and recovery items are kept here. They open only after you unlock with your device biometrics.")} />} />
      {!unlocked ? (
        <View style={s.locked}>
          <View style={s.halo}><View style={s.ring}><Ionicons name="lock-closed" size={46} color="#A78BFA" /></View></View>
          <Text style={s.title}>Protected by device biometrics</Text>
          <Text style={s.sub}>Unlock to view your private files</Text>
          <View style={s.buttons}>
            <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={s.option} onPress={() => void unlock()}>
              <Text style={s.optionText}>{busy ? "Waiting…" : bio?.available ? `Use ${bio.label}` : "Unlock"}</Text>
            </Pressable>

          </View>
          {failed ? <Text style={s.failed} accessibilityLiveRegion="polite">{failed}</Text> : null}
          <Text style={s.auto}>Auto-lock in 5 minutes</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          {error ? <Notice tone="warn" text={error} action={{ label: "Try again", onPress: reload }} /> : null}
          {items === null ? <Loading /> : privateItems.length === 0 ? (
            <Card style={{ padding: 18 }}><Text style={s.sub}>No private items yet.</Text></Card>
          ) : (
            <Card style={{ paddingHorizontal: 14 }}>
              {privateItems.map((item, index) => (
                <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${itemTitle(item)}, open sharing`} style={[s.file, index > 0 && s.border]} onPress={() => router.push("/vault/share")}>
                  <FileIcon type={item.item_type} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.name} numberOfLines={1}>{itemTitle(item)}</Text>
                    <Text style={s.meta}>{formatBytes(item.encrypted_size)} • {relativeDay(item.created_at)} • {typeLabel(item.item_type)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={vault.faint} />
                </Pressable>
              ))}
            </Card>
          )}
          <Text style={s.auto}>Locks automatically after 5 minutes</Text>
        </ScrollView>
      )}
    </VaultScreen>
  );
}

const s = StyleSheet.create({
  locked: { flex: 1, alignItems: "center", paddingHorizontal: 24, paddingTop: 56 },
  halo: { width: 150, height: 150, borderRadius: 75, backgroundColor: "#1B1536", alignItems: "center", justifyContent: "center" },
  ring: { width: 100, height: 100, borderRadius: 50, borderWidth: 4, borderColor: vault.purple, alignItems: "center", justifyContent: "center" },
  title: { color: vault.text, fontFamily: fonts.semibold, fontSize: 18, marginTop: 30 },
  sub: { color: vault.muted, fontFamily: fonts.regular, fontSize: 14, marginTop: 8, textAlign: "center" },
  buttons: { alignSelf: "stretch", gap: 12, marginTop: 36 },
  option: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: vault.border, backgroundColor: vault.card, alignItems: "center", justifyContent: "center" },
  optionAlt: { borderColor: "#1E3A6E", backgroundColor: "transparent" },
  optionText: { color: vault.text, fontFamily: fonts.semibold, fontSize: 15 },
  failed: { color: vault.amber, fontFamily: fonts.medium, fontSize: 13, textAlign: "center", marginTop: 16 },
  auto: { color: vault.faint, fontFamily: fonts.regular, fontSize: 12, textAlign: "center", marginTop: "auto", paddingTop: 24, paddingBottom: 16 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  file: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, minHeight: 62 },
  border: { borderTopWidth: 1, borderTopColor: vault.border },
  name: { color: vault.text, fontFamily: fonts.semibold, fontSize: 15 },
  meta: { color: vault.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 }
});
