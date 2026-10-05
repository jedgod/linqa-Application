import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { SettingsService, type UserSettings } from "../../services/settings.service";
import { accessTokenProvider } from "../../services/session";
import { getApiBaseUrl } from "../../config/api";

const defaults: UserSettings = {
  fontScale: 1, highContrast: false, reducedMotion: false, liveCaptions: false,
  autoDownloadMedia: false, autoCleanupMedia: true, aiMode: "DISABLED"
};

export default function StorageSettingsScreen() {
  const service = useMemo(() => new SettingsService(
    getApiBaseUrl(), accessTokenProvider
  ), []);
  const [settings, setSettings] = useState(defaults);
  const [error, setError] = useState("");
  useEffect(() => { service.getUserSettings().then(setSettings).catch((reason) => setError(String(reason))); }, [service]);
  function update(patch: Partial<UserSettings>) {
    const next = { ...settings, ...patch }; setSettings(next); setError("");
    void service.saveUserSettings(next).catch((reason) => setError(String(reason)));
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Storage</Text>
      <Text style={styles.subtitle}>
        Review encrypted media and device cache usage.
      </Text>

      <View style={styles.usageCard}>
        <View style={styles.usageCircle}>
          <Text style={styles.usageValue}>24%</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.usageTitle}>2.4 GB used</Text>
          <Text style={styles.usageCopy}>7.6 GB available</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Row
          label="Auto-download media"
          value={settings.autoDownloadMedia}
          onChange={(value) => update({ autoDownloadMedia: value })}
        />
        <Row
          label="Automatic cleanup"
          value={settings.autoCleanupMedia}
          onChange={(value) => update({ autoCleanupMedia: value })}
        />
      </View>

      <Pressable style={styles.action}>
        <Ionicons name="trash-outline" size={20} color="#FFB84D" />
        <View style={{ flex: 1 }}>
          <Text style={styles.actionTitle}>Clear cache</Text>
          <Text style={styles.actionCopy}>
            Removes temporary files, not encrypted conversations.
          </Text>
        </View>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.action}>
        <Ionicons name="folder-open-outline" size={20} color="#12D6AE" />
        <View style={{ flex: 1 }}>
          <Text style={styles.actionTitle}>Review large files</Text>
          <Text style={styles.actionCopy}>
            Find media larger than 50 MB.
          </Text>
        </View>
      </Pressable>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: "#1D3A4A", true: "#0A655D" }}
        thumbColor={value ? "#12D6AE" : "#7891A4"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#001520", padding: 16 },
  title: { color: "#F5FBFF", fontSize: 27, fontWeight: "900", marginTop: 18 },
  subtitle: { color: "#748EA1", fontSize: 13, marginTop: 4, marginBottom: 18 },
  usageCard: {
    backgroundColor: "#082536",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#17445A",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 14,
  },
  usageCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#073B3C",
    borderWidth: 3,
    borderColor: "#12D6AE",
    alignItems: "center",
    justifyContent: "center",
  },
  usageValue: { color: "white", fontSize: 20, fontWeight: "900" },
  usageTitle: { color: "#F1F8FC", fontSize: 16, fontWeight: "900" },
  usageCopy: { color: "#748EA1", fontSize: 12, marginTop: 4 },
  card: {
    backgroundColor: "#082536",
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#17445A",
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  row: {
    minHeight: 62,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#123649",
  },
  rowLabel: { color: "#ECF5FA", fontWeight: "700" },
  action: {
    minHeight: 72,
    backgroundColor: "#082536",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#17445A",
    marginBottom: 10,
    padding: 14,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  actionTitle: { color: "#EEF7FB", fontWeight: "800" },
  actionCopy: { color: "#748EA1", fontSize: 12, marginTop: 3 },
  error: { color: "#FF8B97", fontSize: 12 },
});
