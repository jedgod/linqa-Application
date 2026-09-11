import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { SettingsService, type UserSettings } from "../../services/settings.service";
import { accessTokenProvider } from "../../services/session";

type Mode = "DISABLED" | "ON_DEVICE" | "CONFIDENTIAL_CLOUD";

export default function AiPrivacySettingsScreen() {
  const service = useMemo(() => new SettingsService(
    process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8080", accessTokenProvider
  ), []);
  const [mode, setMode] = useState<Mode>("DISABLED");
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    service.getUserSettings().then((value) => { setSettings(value); setMode(value.aiMode); }).catch((reason) => setError(String(reason)));
  }, [service]);
  function update(nextMode: Mode) {
    setMode(nextMode); setError("");
    if (!settings) return;
    const next = { ...settings, aiMode: nextMode }; setSettings(next);
    void service.saveUserSettings(next).catch((reason) => setError(String(reason)));
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>AI privacy</Text>
      <Text style={styles.subtitle}>
        Choose where Linqa AI processing may occur.
      </Text>

      <Option
        active={mode === "DISABLED"}
        icon="close-circle-outline"
        title="Disabled"
        copy="No AI processing is performed."
        onPress={() => update("DISABLED")}
      />
      <Option
        active={mode === "ON_DEVICE"}
        icon="phone-portrait-outline"
        title="On-device"
        copy="Supported AI tasks run locally on this device."
        onPress={() => update("ON_DEVICE")}
      />
      <Option
        active={mode === "CONFIDENTIAL_CLOUD"}
        icon="cloud-outline"
        title="Confidential cloud"
        copy="Encrypted jobs use an approved confidential-computing service."
        onPress={() => update("CONFIDENTIAL_CLOUD")}
      />

      <View style={styles.notice}>
        <Ionicons name="information-circle-outline" size={20} color="#4D8BFF" />
        <Text style={styles.noticeText}>
          AI must never receive message content unless you explicitly enable a
          supported mode.
        </Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

function Option({
  active,
  icon,
  title,
  copy,
  onPress,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  copy: string;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.option, active && styles.optionActive]}
    >
      <View style={styles.optionIcon}>
        <Ionicons name={icon} size={22} color={active ? "#12D6AE" : "#7F98AA"} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionCopy}>{copy}</Text>
      </View>
      <Ionicons
        name={active ? "radio-button-on" : "radio-button-off"}
        size={22}
        color={active ? "#12D6AE" : "#466176"}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#001520", padding: 16 },
  title: { color: "#F5FBFF", fontSize: 27, fontWeight: "900", marginTop: 18 },
  subtitle: { color: "#748EA1", fontSize: 13, marginTop: 4, marginBottom: 18 },
  option: {
    minHeight: 88,
    backgroundColor: "#082536",
    borderWidth: 1,
    borderColor: "#17445A",
    borderRadius: 17,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  optionActive: { borderColor: "#12D6AE", backgroundColor: "#073B3C" },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#061E2C",
    alignItems: "center",
    justifyContent: "center",
  },
  optionTitle: { color: "#EFF7FC", fontSize: 15, fontWeight: "900" },
  optionCopy: { color: "#718A9C", fontSize: 11, lineHeight: 16, marginTop: 4 },
  notice: {
    marginTop: 10,
    backgroundColor: "#09284A",
    borderRadius: 15,
    padding: 13,
    flexDirection: "row",
    gap: 10,
  },
  noticeText: { flex: 1, color: "#9CB8D6", fontSize: 12, lineHeight: 17 },
  error: { color: "#FF8B97", fontSize: 12, marginTop: 8 },
});
