import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Badge, Card, Loading, Notice, Tile, VaultHeader, VaultScreen, useVaultData, vault } from "../../components/vault/ui";
import { biometricInfo } from "../../services/biometric";
import type { VaultIntegrationStatus } from "../../services/vault.service";
import { fonts } from "../../theme/tokens";
import { PlatformSecurityRows } from "../../components/vault/PlatformSecurityRows";
import { useBiometricClient } from "../../services/biometric-session";
import type { BiometricStatus } from "../../services/biometric-client";

const FEATURES: Array<{ key: keyof VaultIntegrationStatus; icon: keyof typeof Ionicons.glyphMap; label: string }> = [
  { key: "encryptedStorage", icon: "lock-closed-outline", label: "End-to-End Encryption" },
  { key: "hashVerification", icon: "checkmark-done-outline", label: "Integrity Verification" },
  { key: "privateVaultSessionLock", icon: "finger-print-outline", label: "Private Vault Lock" },
  { key: "securityScanner", icon: "bug-outline", label: "Security Scanner" },
  { key: "sharing", icon: "share-social-outline", label: "Secure Sharing" },
  { key: "socialImport", icon: "download-outline", label: "Social Import" }
];

/** Security Center (More): what the server reports as really switched on, plus this device. */
export default function VaultSecurity() {
  const router = useRouter();
  const { status, error, reload } = useVaultData();
  const [bio, setBio] = useState<string | null>(null);
  const client = useBiometricClient();
  const [biometricState, setBiometricState] = useState<BiometricStatus | null>(null);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const [biometricBusy, setBiometricBusy] = useState(false);
  useEffect(() => { let current = true; setBiometricState(null); client.status().then(value => { if (current) setBiometricState(value); }).catch(() => undefined); return () => { current = false; }; },[client]);
  async function configureBiometrics(revoke: boolean) {
    if (biometricBusy) return; setBiometricBusy(true); setBiometricError(null);
    try { if (revoke) await client.revokeAll(); else await client.enroll(); setBiometricState(await client.status()); }
    catch (cause) { setBiometricError(cause instanceof Error ? cause.message.replace(/_/g," ") : "Unable to update biometric security."); }
    finally { setBiometricBusy(false); }
  }
  useEffect(() => { void biometricInfo().then((info) => setBio(info.available ? info.label : "Not set up")); }, []);

  const secure = !!status?.encryptedStorage && !!status.hashVerification;

  return (
    <VaultScreen tab="more">
      <VaultHeader title="Security Center" />
      <ScrollView contentContainerStyle={s.content}>
        {error ? <View style={{ marginBottom: 14 }}><Notice tone="warn" text={error} action={{ label: "Try again", onPress: reload }} /></View> : null}
        {!status && !error ? <Loading /> : null}

        {status ? (
          <View style={s.hero}>
            <View style={[s.shield, { backgroundColor: secure ? "#0F2E1C" : "#3A2A0B" }]}>
              <Ionicons name={secure ? "shield-checkmark" : "shield-outline"} size={42} color={secure ? vault.green : vault.amber} />
            </View>
            <Text style={[s.heroTitle, { color: secure ? vault.green : vault.amber }]}>{secure ? "Your vault is encrypted" : "Vault setup is incomplete"}</Text>
            <Text style={s.heroSub}>{secure ? "Files are encrypted before they are stored" : "Encrypted storage is not fully switched on"}</Text>
          </View>
        ) : null}

        {status ? (
          <>
            <Text style={s.section}>Security Features</Text>
            <Card style={{ paddingHorizontal: 14 }}>
              {FEATURES.map((feature, index) => (
                <View key={feature.key} style={[s.row, index > 0 && s.border]}>
                  <Ionicons name={feature.icon} size={18} color={vault.text} />
                  <Text style={s.name}>{feature.label}</Text>
                  <Badge text={status[feature.key] ? "Enabled" : "Not configured"} tone={status[feature.key] ? "ok" : "off"} />
                </View>
              ))}
              <View style={[s.row, s.border]}>
                <Ionicons name="scan-outline" size={18} color={vault.text} />
                <Text style={s.name}>Biometric unlock</Text>
                <Text style={s.value}>{bio ?? "…"}</Text>
              </View>
              <View style={[s.row, s.border]}>
                <Ionicons name="timer-outline" size={18} color={vault.text} />
                <Text style={s.name}>Private Vault auto-lock</Text>
                <Text style={s.value}>5 minutes</Text>
              </View>
            </Card>
          </>
        ) : null}

        <Text style={s.section}>Account Security</Text>
        <PlatformSecurityRows />

        <Text style={s.section}>More</Text>
        {biometricError && <Notice tone="warn" text={biometricError} />}
        <Tile icon="finger-print-outline" color="#7C3AED" title={biometricBusy ? "Updating biometrics…" : biometricState?.enrolled ? "Revoke biometric credentials" : "Enable biometric signing"} subtitle={biometricState?.enrolled ? "Disable biometric access on all devices" : "Protect Private Vault and transfer authorization"} onPress={() => void configureBiometrics(!!biometricState?.enrolled)} />
        <Tile icon="lock-closed" color="#7C3AED" title="Private Vault" subtitle="Identity and recovery items" onPress={() => router.push("/vault/private")} />
        <Tile icon="cloud-outline" color="#2563EB" title="Storage Plans" subtitle="Usage and plans" onPress={() => router.push("/vault/plans")} />
        <Tile icon="download-outline" color="#16A34A" title="Intake Center" subtitle="Bring files into your vault" onPress={() => router.push("/vault/intake")} />
      </ScrollView>
    </VaultScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28 },
  hero: { alignItems: "center", marginTop: 12 },
  shield: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  heroTitle: { fontFamily: fonts.semibold, fontSize: 18, marginTop: 12 },
  heroSub: { color: vault.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 4, textAlign: "center" },
  section: { color: vault.text, fontFamily: fonts.semibold, fontSize: 14, marginTop: 24, marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 12 },
  border: { borderTopWidth: 1, borderTopColor: vault.border },
  name: { flex: 1, color: vault.text, fontFamily: fonts.medium, fontSize: 14 },
  value: { color: vault.muted, fontFamily: fonts.medium, fontSize: 12 }
});
