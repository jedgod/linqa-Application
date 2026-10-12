import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { DeviceLinkError, deviceLinks, parseLinkCode, type LinkedDevice } from "../services/device-link.service";

const INK = "#0F172A";
const MUTED = "#64748B";
const PURPLE = "#5B4CFF";

const platformLabel = (platform: string) => (platform === "WEB" ? "Web browser" : platform === "DESKTOP" ? "Desktop app" : platform === "ANDROID" ? "Android phone" : platform === "IOS" ? "iPhone" : platform);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not yet");

/** Linked devices: scan a QR code from Linqa Web to link a computer, see everything linked to this account, and unlink any of it. */
export default function LinkedDevicesScreen() {
  const router = useRouter();
  const [devices, setDevices] = useState<LinkedDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try { setDevices(await deviceLinks.list()); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load your devices."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openScanner = async () => {
    setNotice(null);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) { setNotice("Allow camera access to scan the code on your computer."); return; }
    }
    handled.current = false;
    setScanning(true);
  };

  const onScanned = async (data: string) => {
    if (handled.current) return;
    handled.current = true;
    const code = parseLinkCode(data);
    if (!code) { setScanning(false); setNotice("That is not a Linqa link code."); return; }
    setBusy(true);
    try {
      const preview = await deviceLinks.preview(code.linkId, code.secret);
      setScanning(false);
      setBusy(false);
      Alert.alert(
        `Link "${preview.deviceName}"?`,
        `This lets that ${platformLabel(preview.platform).toLowerCase()} read and send your Linqa messages. Only continue if you are looking at it right now and you started this.`,
        [
          { text: "Cancel", style: "cancel", onPress: () => void deviceLinks.deny(code.linkId, code.secret).catch(() => undefined) },
          { text: "Link", onPress: () => void approve(code.linkId, code.secret, preview.deviceName) }
        ]
      );
    } catch (cause) {
      setScanning(false);
      setBusy(false);
      setNotice(cause instanceof DeviceLinkError ? cause.message : "Could not read that code.");
    }
  };

  const approve = async (linkId: string, secret: string, name: string) => {
    setBusy(true);
    try {
      await deviceLinks.approve(linkId, secret);
      setNotice(`Linking "${name}". Finish on your computer.`);
      setTimeout(() => void load(), 4000);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not link that device."); } finally { setBusy(false); }
  };

  const unlink = (device: LinkedDevice) =>
    Alert.alert(`Unlink "${device.deviceName}"?`, "It will be signed out and will stop receiving your messages. You can link it again later.", [
      { text: "Cancel", style: "cancel" },
      { text: "Unlink", style: "destructive", onPress: async () => {
        try { await deviceLinks.unlink(device.id); setNotice(`"${device.deviceName}" was unlinked.`); await load(); } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not unlink that device."); }
      } }
    ]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={24} color={INK} /></Pressable>
        <Text accessibilityRole="header" style={styles.title}>Linked devices</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.card}>
        <Ionicons name="desktop-outline" size={30} color={PURPLE} />
        <Text style={styles.cardTitle}>Use Linqa on a computer</Text>
        <Text style={styles.cardBody}>On your computer open Linqa Web and choose "Link with phone". A QR code appears. Scan it here and approve.</Text>
        <Pressable accessibilityRole="button" onPress={() => void openScanner()} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="qr-code-outline" size={20} color="#fff" /><Text style={styles.primaryText}>Scan QR code</Text></>}
        </Pressable>
        {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
      </View>

      <Text style={styles.section}>Devices on this account</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {devices === null && !error ? <ActivityIndicator color={PURPLE} style={{ marginTop: 24 }} /> : null}
      <FlatList
        data={devices ?? []}
        keyExtractor={(device) => device.id}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
        ListEmptyComponent={devices ? <Text style={styles.empty}>No devices yet.</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Ionicons name={item.platform === "WEB" || item.platform === "DESKTOP" ? "desktop-outline" : "phone-portrait-outline"} size={26} color={INK} />
            <View style={{ flex: 1 }}>
              <Text style={styles.deviceName}>{item.deviceName}{item.current ? "  ·  This phone" : ""}</Text>
              <Text style={styles.deviceMeta}>{platformLabel(item.platform)} · Last active {when(item.lastSeenAt)}</Text>
            </View>
            {!item.current ? <Pressable accessibilityRole="button" accessibilityLabel={`Unlink ${item.deviceName}`} onPress={() => unlink(item)} hitSlop={8}><Text style={styles.unlink}>Unlink</Text></Pressable> : null}
          </View>
        )}
      />

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={styles.scanner}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => void onScanned(data)}
          />
          <SafeAreaView style={styles.scanUi}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close scanner" onPress={() => setScanning(false)} style={styles.scanClose}><Ionicons name="close" size={26} color="#fff" /></Pressable>
            <View style={styles.frame} />
            <Text style={styles.scanHint}>Point the camera at the QR code on your computer</Text>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F6FC" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: INK, fontSize: 19, fontWeight: "700" },
  card: { margin: 16, padding: 20, borderRadius: 20, backgroundColor: "#FFFFFF", gap: 10 },
  cardTitle: { color: INK, fontSize: 18, fontWeight: "700" },
  cardBody: { color: MUTED, fontSize: 15, lineHeight: 22 },
  primary: { minHeight: 50, borderRadius: 14, backgroundColor: PURPLE, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 4 },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  notice: { color: INK, backgroundColor: "#E9E6FF", padding: 10, borderRadius: 10, overflow: "hidden" },
  section: { color: MUTED, fontSize: 13, fontWeight: "700", letterSpacing: 0.5, paddingHorizontal: 20, paddingBottom: 8, textTransform: "uppercase" },
  error: { color: "#B42318", paddingHorizontal: 20 },
  empty: { color: MUTED, textAlign: "center", marginTop: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFFFFF", borderRadius: 16, padding: 14 },
  deviceName: { color: INK, fontSize: 16, fontWeight: "600" },
  deviceMeta: { color: MUTED, fontSize: 13, marginTop: 2 },
  unlink: { color: "#D92D20", fontSize: 15, fontWeight: "700" },
  scanner: { flex: 1, backgroundColor: "#000" },
  scanUi: { flex: 1, alignItems: "center", justifyContent: "space-between" },
  scanClose: { alignSelf: "flex-start", margin: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: "#0008", alignItems: "center", justifyContent: "center" },
  frame: { width: 250, height: 250, borderRadius: 24, borderWidth: 3, borderColor: "#FFFFFF" },
  scanHint: { color: "#fff", fontSize: 16, backgroundColor: "#0008", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, marginBottom: 40, overflow: "hidden" }
});
