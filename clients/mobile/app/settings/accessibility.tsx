import React, { useEffect, useMemo, useState } from "react";
import { SafeAreaView, StyleSheet, Switch, Text, View } from "react-native";
import { SettingsService, type UserSettings } from "../../services/settings.service";
import { accessTokenProvider } from "../../services/session";

const defaults: UserSettings = {
  fontScale: 1, highContrast: false, reducedMotion: false, liveCaptions: false,
  autoDownloadMedia: false, autoCleanupMedia: true, aiMode: "DISABLED"
};

export default function AccessibilitySettingsScreen() {
  const service = useMemo(() => new SettingsService(
    process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080", accessTokenProvider
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
      <Text style={styles.title}>Accessibility</Text>
      <Text style={styles.subtitle}>
        Adjust Linqa for comfortable communication.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Text size</Text>
        <View style={styles.scaleRow}>
          {[0.9, 1, 1.15, 1.3].map((value) => (
            <Text
              key={value}
              onPress={() => update({ fontScale: value })}
              style={[
                styles.scale,
                settings.fontScale === value && styles.scaleActive,
                { fontSize: 15 * value },
              ]}
            >
              Aa
            </Text>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Row label="High contrast" value={settings.highContrast} onChange={(value) => update({ highContrast: value })} />
        <Row label="Reduced motion" value={settings.reducedMotion} onChange={(value) => update({ reducedMotion: value })} />
        <Row label="Live captions" value={settings.liveCaptions} onChange={(value) => update({ liveCaptions: value })} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
  card: {
    backgroundColor: "#082536",
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#17445A",
    padding: 14,
    marginBottom: 14,
  },
  label: { color: "#ECF5FA", fontWeight: "800" },
  scaleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
  },
  scale: {
    width: 58,
    height: 48,
    borderRadius: 13,
    backgroundColor: "#061E2C",
    color: "#8398A7",
    textAlign: "center",
    textAlignVertical: "center",
    paddingTop: 13,
  },
  scaleActive: {
    backgroundColor: "#0A4D4A",
    color: "#12D6AE",
    borderWidth: 1,
    borderColor: "#12D6AE",
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
  error: { color: "#FF8B97", fontSize: 12 },
});
