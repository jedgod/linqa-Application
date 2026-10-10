import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Notice, ProgressBar, VaultHeader, VaultScreen, vault } from "../../components/vault/ui";
import { getApiBaseUrl } from "../../config/api";
import { accessTokenProvider } from "../../services/session";
import { VaultService, type VaultImportStatus } from "../../services/vault.service";
import { failureText, formatBytes, isFinalImportState } from "../../services/vault-view";
import { fonts } from "../../theme/tokens";

const POLL_MS = 1500;

function CheckIcon({ state }: { state: VaultImportStatus["checks"][number]["state"] }) {
  if (state === "done") return <View style={[s.dot, { backgroundColor: vault.green }]}><Ionicons name="checkmark" size={14} color="#FFFFFF" /></View>;
  if (state === "failed") return <View style={[s.dot, { backgroundColor: vault.red }]}><Ionicons name="close" size={14} color="#FFFFFF" /></View>;
  if (state === "active") return <ActivityIndicator size="small" color={vault.blueText} style={s.dot} />;
  return <Ionicons name="ellipse-outline" size={20} color={vault.faint} />;
}

/**
 * Security Scan. Everything shown comes from the server's status for this import: the checks, the
 * percentage and the outcome. When the file is clean it moves on to Save to Vault; if the scan
 * stops, it says why and nothing is saved.
 */
export default function VaultSecurityScan() {
  const router = useRouter();
  const params = useLocalSearchParams<{ importId?: string; folderId?: string; folderPath?: string; name?: string }>();
  const client = useMemo(() => new VaultService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()), []);
  const [status, setStatus] = useState<VaultImportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.importId) return;
    let stopped = false;
    async function poll() {
      while (!stopped) {
        try {
          const next = await client.importStatus(params.importId!);
          if (stopped) return;
          setStatus(next);
          if (isFinalImportState(next.state)) {
            if (next.state === "AWAITING_CONFIRMATION") {
              router.replace({ pathname: "/vault/save", params: { importId: next.importId, file: params.name || next.filename || "File", size: next.sizeBytes !== null ? formatBytes(next.sizeBytes) : "", folderId: params.folderId ?? "", folderPath: params.folderPath || "My Vault" } });
            }
            return;
          }
        } catch (cause) {
          if (!stopped) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to check the scan.");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }
    void poll();
    return () => { stopped = true; };
  }, [client, params.importId, params.name, params.folderId, params.folderPath, router]);

  const stopped = status?.state === "FAILED" || status?.state === "BLOCKED";
  const title = stopped ? "Scan stopped" : "Scanning file...";
  const file = params.name || status?.filename || "";

  return (
    <VaultScreen tab="files" tabs={false}>
      <VaultHeader title="Security Scan" back />
      <ScrollView contentContainerStyle={s.content}>
        {!params.importId ? (
          <Notice text="There is no file being scanned. Start from Save from Social." />
        ) : (
          <>
            <View style={[s.ring, stopped && { borderColor: "#4A1D1D" }]}>
              <View style={[s.ringInner, stopped && { borderColor: vault.red }]}>
                <Ionicons name={stopped ? "shield-outline" : "shield-checkmark-outline"} size={62} color={stopped ? vault.red : vault.blueText} />
              </View>
            </View>
            <Text style={s.title} accessibilityLiveRegion="polite">{title}</Text>
            {file ? <Text style={s.file} numberOfLines={1}>{file}</Text> : null}

            <View style={s.checks}>
              {(status?.checks ?? []).map((check) => (
                <View key={check.key} style={s.check} accessibilityLabel={`${check.label}: ${check.state === "done" ? "done" : check.state === "failed" ? "failed" : check.state === "active" ? "in progress" : "waiting"}`}>
                  <CheckIcon state={check.state} />
                  <Text style={[s.checkText, check.state === "pending" && { color: vault.muted }]}>{check.label}</Text>
                </View>
              ))}
              {!status && !error ? <ActivityIndicator color={vault.blueText} /> : null}
            </View>

            {status && !stopped ? (
              <>
                <ProgressBar value={status.progress} />
                <Text style={s.percent}>{status.progress}%</Text>
                <Text style={s.hint}>Please wait while we ensure this file is safe.</Text>
              </>
            ) : null}

            {stopped ? (
              <>
                <Notice tone="warn" text={failureText(status?.failureCode)} />
                <Pressable accessibilityRole="button" style={s.back} onPress={() => (router.canGoBack() ? router.back() : router.replace("/vault"))}>
                  <Text style={s.backText}>Back</Text>
                </Pressable>
              </>
            ) : null}
            {error ? <Notice tone="warn" text={error} /> : null}
          </>
        )}
      </ScrollView>
    </VaultScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 24, paddingTop: 30, paddingBottom: 28 },
  ring: { alignSelf: "center", width: 160, height: 160, borderRadius: 80, borderWidth: 8, borderColor: "#173A78", alignItems: "center", justifyContent: "center" },
  ringInner: { width: 112, height: 112, borderRadius: 56, borderWidth: 4, borderColor: vault.blue, alignItems: "center", justifyContent: "center" },
  title: { color: vault.text, fontFamily: fonts.semibold, fontSize: 18, textAlign: "center", marginTop: 26 },
  file: { color: vault.muted, fontFamily: fonts.regular, fontSize: 14, textAlign: "center", marginTop: 4 },
  checks: { gap: 16, marginVertical: 28, minHeight: 60 },
  check: { flexDirection: "row", alignItems: "center", gap: 12 },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  checkText: { flex: 1, color: vault.text, fontFamily: fonts.regular, fontSize: 15 },
  percent: { color: vault.text, fontFamily: fonts.medium, fontSize: 13, textAlign: "right", marginTop: 6 },
  hint: { color: vault.muted, fontFamily: fonts.regular, fontSize: 12, textAlign: "center", marginTop: 12 },
  back: { alignItems: "center", justifyContent: "center", minHeight: 48, marginTop: 16 },
  backText: { color: vault.blueText, fontFamily: fonts.semibold, fontSize: 15 }
});
