import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { getApiBaseUrl } from "../../config/api";
import { accessTokenProvider } from "../../services/session";
import { VaultService, type VaultSecurityCenter } from "../../services/vault.service";
import { fonts } from "../../theme/tokens";
import { Badge, Card, vault } from "./ui";

/**
 * Two-factor, trusted devices and login alerts, read from the platform's own account data
 * (passkeys, linked devices). The Vault keeps no counters of its own for any of these.
 */
export function PlatformSecurityRows() {
  const client = useMemo(() => new VaultService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()), []);
  const [data, setData] = useState<VaultSecurityCenter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    client.securityCenter().then((value) => { if (active) { setData(value); setError(null); } }, (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load"); });
    return () => { active = false; };
  }, [client]));

  async function toggleAlerts(enabled: boolean) {
    if (!data) return;
    const before = data;
    setData({ ...data, loginAlerts: { enabled } });
    try { await client.setLoginAlerts(enabled); }
    catch { setData(before); setError("Unable to change login alerts."); }
  }

  if (error && !data) return <Card style={{ padding: 14, marginTop: 14 }}><Text style={s.err}>Account security: {error}</Text></Card>;
  if (!data) return null;
  return (
    <Card style={{ paddingHorizontal: 14, marginTop: 14 }}>
      <View style={s.row}>
        <Ionicons name="key-outline" size={18} color={vault.text} />
        <Text style={s.name}>Two-Factor Authentication</Text>
        <Badge text={data.twoFactor.enabled ? "Enabled" : "Not set up"} tone={data.twoFactor.enabled ? "ok" : "off"} />
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} style={[s.row, s.border]} onPress={() => setOpen((v) => !v)}>
        <Ionicons name="laptop-outline" size={18} color={vault.text} />
        <Text style={s.name}>Trusted Devices</Text>
        <Text style={s.value}>{data.trustedDevices.count} {data.trustedDevices.count === 1 ? "device" : "devices"}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={vault.faint} />
      </Pressable>
      {open ? data.trustedDevices.devices.map((device) => (
        <View key={device.id} style={s.device}>
          <Text style={s.deviceName}>{device.name}</Text>
          <Text style={s.deviceMeta}>{[device.platform, device.trusted ? "Trusted" : "Not trusted"].filter(Boolean).join(" · ")}</Text>
        </View>
      )) : null}
      <View style={[s.row, s.border]}>
        <Ionicons name="notifications-outline" size={18} color={vault.text} />
        <Text style={s.name}>Login Alerts</Text>
        <Switch value={data.loginAlerts.enabled} trackColor={{ true: vault.blue, false: vault.border }} thumbColor="#FFFFFF" onValueChange={(v) => void toggleAlerts(v)} accessibilityLabel="Login alerts" />
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 10 },
  border: { borderTopWidth: 1, borderTopColor: vault.border },
  name: { flex: 1, color: vault.text, fontFamily: fonts.medium, fontSize: 14 },
  value: { color: vault.muted, fontFamily: fonts.medium, fontSize: 12 },
  device: { paddingLeft: 30, paddingBottom: 10 },
  deviceName: { color: vault.text, fontFamily: fonts.regular, fontSize: 13 },
  deviceMeta: { color: vault.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  err: { color: vault.amber, fontFamily: fonts.medium, fontSize: 13 }
});
