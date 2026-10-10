import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar, LinqaSendStatusBar, countryName, deliveryLabel, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { LinqaSendService, type LinqaSendTransferDetail } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { receiptRows, receiptShareText } from "../../services/transfer-receipt";
import { fonts } from "../../theme/tokens";

const API = getApiBaseUrl();
const GREEN = "#12A150";

/** Transaction Details: the receipt for one transfer. Unfinished transfers go to the tracking screen instead. */
export default function LinqaSendReceipt() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [transfer, setTransfer] = useState<LinqaSendTransferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client.getTransfer(id).then(
      (detail) => {
        if (!active) return;
        if (detail.status !== "COMPLETED") router.replace({ pathname: "/linqasend/status", params: { id } });
        else setTransfer(detail);
      },
      (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to load this receipt."); }
    );
    return () => { active = false; };
  }, [client, id, router]);

  const received = transfer?.direction === "RECEIVED";
  const detailLine = transfer && !received ? [countryName(transfer.recipientCountry), deliveryLabel(transfer.recipientType ?? undefined)].filter(Boolean).join(" · ") : "";

  async function share() {
    if (!transfer) return;
    try { await Share.share({ message: receiptShareText(transfer) }); } catch { /* the user closed the sheet or sharing is unavailable */ }
  }

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.headerButton} onPress={() => (router.canGoBack() ? router.back() : router.replace("/linqasend/history"))}>
          <Ionicons name="arrow-back" size={26} color={send.text} />
        </Pressable>
        <Text accessibilityRole="header" style={s.title}>Transaction Details</Text>
        <View style={s.headerButton} />
      </View>

      {!transfer && !error ? <View style={s.center}><ActivityIndicator color={send.primary} /></View> : null}
      {error ? (
        <View style={s.center}>
          <Text style={s.muted}>{error}</Text>
          <Pressable accessibilityRole="button" style={{ marginTop: 14 }} onPress={() => router.replace("/linqasend/history")}><Text style={s.link}>Back to history</Text></Pressable>
        </View>
      ) : null}

      {transfer ? (
        <>
          <ScrollView contentContainerStyle={s.content}>
            <View style={s.check}><Ionicons name="checkmark" size={44} color="#FFFFFF" /></View>
            <Text style={s.done}>Transfer Completed</Text>

            <View style={s.party}>
              <Text style={s.partyLabel}>{received ? "From" : "To"}</Text>
              <View style={s.partyRow}>
                <Avatar name={transfer.recipientName} size={50} />
                <View style={{ flex: 1 }}>
                  <Text style={s.partyName} numberOfLines={1}>{transfer.recipientName}</Text>
                  {detailLine ? <Text style={s.partyMeta}>{detailLine}</Text> : null}
                </View>
              </View>
            </View>

            {receiptRows(transfer).map((row) => (
              <View key={row.label} style={s.row}>
                <Text style={s.rowLabel}>{row.label}</Text>
                <Text style={s.rowValue} selectable={row.label === "Reference ID"}>{row.value}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={s.footer}>
            <Pressable accessibilityRole="button" style={s.share} onPress={() => void share()}>
              <Ionicons name="share-outline" size={22} color="#FFFFFF" />
              <Text style={s.shareText}>Share Receipt</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: send.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: send.text, fontFamily: fonts.extrabold, fontSize: 18 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  muted: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, textAlign: "center" },
  link: { color: send.primary, fontFamily: fonts.bold, fontSize: 15 },
  content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 20 },
  check: { alignSelf: "center", width: 84, height: 84, borderRadius: 42, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  done: { color: send.text, fontFamily: fonts.extrabold, fontSize: 22, textAlign: "center", marginTop: 16, marginBottom: 22 },
  party: { backgroundColor: send.surface, borderRadius: 16, padding: 16, marginBottom: 6 },
  partyLabel: { color: send.muted, fontFamily: fonts.medium, fontSize: 13, marginBottom: 10 },
  partyRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  partyName: { color: send.text, fontFamily: fonts.bold, fontSize: 17 },
  partyMeta: { color: send.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 3 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16, paddingVertical: 17, borderBottomWidth: 1, borderBottomColor: send.border },
  rowLabel: { color: send.muted, fontFamily: fonts.medium, fontSize: 15 },
  rowValue: { color: send.text, fontFamily: fonts.bold, fontSize: 15, flexShrink: 1, textAlign: "right" },
  footer: { paddingHorizontal: 24, paddingBottom: 18, paddingTop: 8 },
  share: { height: 56, borderRadius: 16, backgroundColor: send.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  shareText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 17 }
});
