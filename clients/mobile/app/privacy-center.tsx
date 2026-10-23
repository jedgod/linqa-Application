import React, { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  PrivacyCenterService,
  type DeviceAlert,
  type PrivacySummary,
} from "../services/privacy-center.service";
import { accessTokenProvider } from "../services/session";
import { LinkedDeviceAlertCard } from "../components/LinkedDeviceAlertCard";
import { getApiBaseUrl } from "../config/api";
import { PrivacyControlsSection } from "../components/PrivacyControls";

export default function PrivacyCenterScreen() {
  const router = useRouter();
  const service = useMemo(
    () =>
      new PrivacyCenterService(
        getApiBaseUrl(),
        () => accessTokenProvider.getAccessToken(),
      ),
    [],
  );

  const [summary, setSummary] = useState<PrivacySummary | null>(null);
  const [alerts, setAlerts] = useState<DeviceAlert[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([service.summary(), service.alerts()])
      .then(([result, deviceAlerts]) => {
        if (active) { setSummary(result); setAlerts(deviceAlerts); }
      })
      .catch((err) => {
        // 2026-08-07 crash fix: unguarded .then() with no .catch() — an
        // unhandled promise rejection crashed the app instead of showing
        // this screen's own error state.
        if (active) setError(err instanceof Error ? err.message : "Unable to load Privacy Center.");
      });
    return () => {
      active = false;
    };
  }, [service]);

  if (error) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={{ alignItems: "flex-end", padding: 16 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/linqa"))} style={styles.close}>
            <Ionicons name="close" size={20} color="#F5FBFF" />
          </Pressable>
        </View>
        <Text style={styles.loading}>{error}</Text>
      </SafeAreaView>
    );
  }

  if (!summary) {
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.loading}>Loading Privacy Center…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>TRUST CENTER</Text>
            <Text style={styles.title}>Privacy Center</Text>
          </View>
          <View style={styles.score}>
            <Text style={styles.scoreValue}>{summary.privacyScore}</Text>
            <Text style={styles.scoreLabel}>Score</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/linqa"))} style={styles.close}>
            <Ionicons name="close" size={20} color="#F5FBFF" />
          </Pressable>
        </View>

        <SecurityItem
          icon="shield-checkmark-outline"
          title="Encryption status"
          subtitle={summary.secureCoreReady ? "Secure core ready" : "Core unavailable"}
          tone={summary.secureCoreReady ? "good" : "warn"}
        />

        <PrivacyControlsSection />

        {alerts.length ? (
          <Section title="Device alerts">
            {alerts.map((alert) => (
              <View key={alert.id} style={{ marginBottom: 8 }}>
                <LinkedDeviceAlertCard
                  deviceName={alert.deviceName}
                  platform={alert.platform}
                  createdAt={alert.createdAt}
                  riskLevel={alert.riskLevel}
                  onVerify={() => {
                    void service.acknowledgeAlert(alert.id)
                      .then(() => setAlerts((items) => items.filter((item) => item.id !== alert.id)))
                      .catch((reason) => Alert.alert("Unable to verify", String(reason)));
                  }}
                  onRevoke={() => {
                    void service.revokeDevice(alert.deviceId)
                      .then(() => setAlerts((items) => items.filter((item) => item.id !== alert.id)))
                      .catch((reason) => Alert.alert("Unable to revoke", String(reason)));
                  }}
                />
              </View>
            ))}
          </Section>
        ) : null}

        <Section title="Trusted devices">
          {summary.devices.map((device) =>
            device.riskLevel !== "LOW" ? (
              <View key={device.id} style={{ marginBottom: 8 }}>
                <LinkedDeviceAlertCard
                  deviceName={device.deviceName}
                  platform={device.platform}
                  createdAt={device.registeredAt ?? new Date().toISOString()}
                  riskLevel={device.riskLevel}
                  onVerify={() => router.push("/security/key-transparency")}
                  onRevoke={() => {
                    Alert.alert("Revoke device?", `This will disconnect ${device.deviceName}.`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Revoke", style: "destructive", onPress: () => {
                        void service.revokeDevice(device.id)
                          .then(() => setSummary((current) => current ? {
                            ...current,
                            devices: current.devices.filter((item) => item.id !== device.id)
                          } : current))
                          .catch((reason) => Alert.alert("Unable to revoke", String(reason)));
                      } }
                    ]);
                  }}
                />
              </View>
            ) : (
              <SecurityItem
                key={device.id}
                icon="phone-portrait-outline"
                title={device.deviceName}
                subtitle={`${device.platform} · ${device.status}`}
                tone="good"
              />
            )
          )}
        </Section>

        <Section title="Active sessions">
          {summary.sessions.map((session) => (
            <SecurityItem
              key={session.id}
              icon="key-outline"
              title={session.revokedAt ? "Revoked session" : "Active session"}
              subtitle={new Date(session.createdAt).toLocaleString()}
              tone={session.revokedAt ? "neutral" : "good"}
            />
          ))}
        </Section>

        <Section title="Account controls">
          <SecurityItem
            icon="ban-outline"
            title="Blocked users"
            subtitle={`${summary.blockedCount} blocked`}
            tone="neutral"
          />
          <SecurityItem
            icon="download-outline"
            title="Export your data"
            subtitle="Request a copy of your data"
            tone="neutral"
            onPress={() => router.push("/settings/privacy-rights")}
          />
          <SecurityItem
            icon="trash-outline"
            title="Delete account"
            subtitle="Schedule permanent account deletion"
            tone="danger"
            onPress={() => router.push("/settings/privacy-rights")}
          />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function SecurityItem({
  icon,
  title,
  subtitle,
  tone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  tone: "good" | "warn" | "danger" | "neutral";
  onPress?: () => void;
}) {
  const color =
    tone === "good"
      ? "#12D6AE"
      : tone === "warn"
        ? "#FFB84D"
        : tone === "danger"
          ? "#FF6B7A"
          : "#7F98AA";

  return (
    <Pressable style={styles.item} onPress={onPress} accessibilityRole={onPress ? "button" : undefined}>
      <View style={styles.itemIcon}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle}>{title}</Text>
        <Text style={styles.itemSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#466176" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#001520" },
  loading: { color: "#7D95A8", textAlign: "center", marginTop: 100 },
  content: { padding: 16, paddingBottom: 80 },
  header: {
    paddingTop: 12,
    marginBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eyebrow: {
    color: "#12D6AE",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  title: { color: "#F5FBFF", fontSize: 28, fontWeight: "900", marginTop: 2 },
  close: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: "#17445A", backgroundColor: "#082536", alignItems: "center", justifyContent: "center", marginLeft: 10 },
  score: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "#073B3C",
    borderWidth: 2,
    borderColor: "#12D6AE",
    alignItems: "center",
    justifyContent: "center",
  },
  scoreValue: { color: "white", fontSize: 22, fontWeight: "900" },
  scoreLabel: { color: "#6F9A9B", fontSize: 9 },
  section: { marginTop: 18 },
  sectionTitle: {
    color: "#6F889A",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 8,
  },
  item: {
    minHeight: 72,
    backgroundColor: "#082536",
    borderWidth: 1,
    borderColor: "#17445A",
    borderRadius: 15,
    padding: 12,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  itemIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: "#061E2C",
    alignItems: "center",
    justifyContent: "center",
  },
  itemTitle: { color: "#EFF7FC", fontSize: 14, fontWeight: "800" },
  itemSubtitle: { color: "#718A9C", fontSize: 12, marginTop: 3 },
});
