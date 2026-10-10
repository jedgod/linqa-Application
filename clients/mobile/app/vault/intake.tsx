import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Badge, IconButton, Notice, Tile, VaultHeader, VaultScreen, useVaultData, vault } from "../../components/vault/ui";
import type { VaultIntegrationStatus } from "../../services/vault.service";

type Source = { key: string; icon: keyof typeof Ionicons.glyphMap; color: string; title: string; subtitle: string; ready: (s: VaultIntegrationStatus | null) => boolean; why: string };

const SOURCES: Source[] = [
  { key: "social", icon: "chatbubble-ellipses", color: "#16A34A", title: "From Linqa Social", subtitle: "Save posts, attachments", ready: (s) => !!s?.socialImport, why: "Saving from Linqa Social needs the social import service, which is not connected yet." },
  { key: "messages", icon: "chatbubbles", color: "#2563EB", title: "From Messages", subtitle: "Save message attachments", ready: () => false, why: "Saving message attachments is not connected to the vault yet." },
  { key: "business", icon: "briefcase", color: "#7C3AED", title: "From Client / Business", subtitle: "Save files from clients", ready: () => false, why: "Business intake is not connected yet." },
  { key: "device", icon: "phone-portrait", color: "#16A34A", title: "From Device", subtitle: "Upload from this device", ready: () => false, why: "Uploads must be encrypted on your device before they leave it. The on-device encryption and file picker are not part of this app build yet, so uploading is turned off rather than sending files unprotected." },
  { key: "link", icon: "link", color: "#7C3AED", title: "From External Link", subtitle: "Secure link or shared file", ready: () => false, why: "Saving from a shared link is not connected yet." },
  { key: "scan", icon: "scan", color: "#EA580C", title: "Scan Document", subtitle: "Scan and save to vault", ready: () => false, why: "Document scanning needs the on-device encryption step and is not available yet." }
];

/** Intake Center: every way to bring a file in. Sources the app cannot do safely yet say so. */
export default function VaultIntake() {
  const router = useRouter();
  const { status } = useVaultData();
  const [why, setWhy] = useState<string | null>(null);

  return (
    <VaultScreen tab="files">
      <VaultHeader title="Intake Center" subtitle="Bring files into your secure vault" right={<IconButton icon="information-circle-outline" label="About intake" onPress={() => setWhy("Everything you add is checked, then encrypted on your device. The server only ever stores encrypted content.")} />} />
      <ScrollView contentContainerStyle={s.content}>
        {why ? <View style={{ marginBottom: 14 }}><Notice text={why} /></View> : null}
        {SOURCES.map((source) => {
          const ready = source.ready(status);
          return (
            <Tile
              key={source.key}
              icon={source.icon}
              color={source.color}
              title={source.title}
              subtitle={source.subtitle}
              disabled={!ready}
              trailing={ready ? undefined : <Badge text="Not available" tone="off" />}
              onPress={() => { if (ready && source.key === "social") router.push("/vault/social"); else setWhy(source.why); }}
            />
          );
        })}
        <Text style={s.fine}>Files from Linqa Social are saved only when you ask, and are scanned before they reach your vault.</Text>
      </ScrollView>
    </VaultScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  fine: { color: vault.faint, fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: "center" }
});
