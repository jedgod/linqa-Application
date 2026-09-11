import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsService, type NotificationPreferences } from "../../services/settings.service";
import { accessTokenProvider } from "../../services/session";

const defaults: NotificationPreferences = {
  messages: true, calls: true, communities: true, business: true,
  mentionsOnly: false, quietHoursStart: null, quietHoursEnd: null,
  timezone: null, priorityContactIds: []
};

export default function NotificationSettingsScreen() {
  const service = useMemo(() => new SettingsService(
    process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8080",
    accessTokenProvider
  ), []);
  const [preferences, setPreferences] = useState(defaults);
  const [error, setError] = useState("");

  useEffect(() => {
    service.getNotifications().then(setPreferences).catch((reason) => setError(String(reason)));
  }, [service]);

  function update(patch: Partial<NotificationPreferences>) {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    setError("");
    void service.saveNotifications(next).catch((reason) => setError(String(reason)));
  }

  const quietHours = preferences.quietHoursStart !== null;

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Notifications</Text>
      <Text style={styles.subtitle}>
        Control alerts, previews, and quiet hours.
      </Text>

      <View style={styles.card}>
        <SettingRow label="Messages" value={preferences.messages} onChange={(value) => update({ messages: value })} />
        <SettingRow label="Calls" value={preferences.calls} onChange={(value) => update({ calls: value })} />
        <SettingRow
          label="Communities"
          value={preferences.communities}
          onChange={(value) => update({ communities: value })}
        />
        <SettingRow
          label="Business chats"
          value={preferences.business}
          onChange={(value) => update({ business: value })}
        />
        <SettingRow
          label="Mentions only"
          value={preferences.mentionsOnly}
          onChange={(value) => update({ mentionsOnly: value })}
        />
      </View>

      <View style={styles.card}>
        <SettingRow
          label="Quiet hours"
          value={quietHours}
          onChange={(value) => update({
            quietHoursStart: value ? "22:00" : null,
            quietHoursEnd: value ? "07:00" : null
          })}
        />
        {quietHours && (
          <Pressable style={styles.timeRow}>
            <Text style={styles.timeLabel}>Schedule</Text>
            <Text style={styles.timeValue}>10:00 PM – 7:00 AM</Text>
          </Pressable>
        )}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

function SettingRow({
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
  timeRow: {
    minHeight: 60,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  timeLabel: { color: "#ECF5FA", fontWeight: "700" },
  timeValue: { color: "#12D6AE", fontWeight: "800" },
  error: { color: "#FF8B97", fontSize: 12 },
});
