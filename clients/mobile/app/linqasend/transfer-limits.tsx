import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LimitsGauge } from "../../components/linqasend/LimitsGauge";
import { LinqaSendStatusBar, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { LinqaSendService, type LinqaSendLimits } from "../../services/linqasend.service";
import { usedShare } from "../../services/linqasend-limits";
import { accessTokenProvider } from "../../services/session";
import { fonts } from "../../theme/tokens";

const API = getApiBaseUrl();
const usd = (minor: string | number) => `$${(Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const maybe = (minor: string | null | undefined, empty: string) => (minor === null || minor === undefined ? empty : usd(minor));

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <View style={s.row}><Text style={strong ? s.rowStrong : s.rowLabel}>{label}</Text><Text style={strong ? s.rowStrong : s.rowValue}>{value}</Text></View>;
}

/** Transfer Limits: only limits the account really has. "No fixed limit" is shown rather than a made-up number. */
export default function LinqaSendTransferLimits() {
  const router = useRouter();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [limits, setLimits] = useState<LinqaSendLimits | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setLimits(await client.getLimits()); }
    catch (cause) { setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to load your limits"); }
  }, [client]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const currency = limits?.currency ?? "USD";
  const daily = limits?.daily ?? { limitMinor: null, usedMinor: limits?.rolling24Hours.usedMinor ?? "0", remainingMinor: null };
  const monthly = limits?.monthly ?? { limitMinor: null, usedMinor: "0", remainingMinor: null };
  const share = usedShare(daily.limitMinor, daily.usedMinor);

  function learnMore() {
    Alert.alert(
      "About transfer limits",
      "Limits keep your money safe and meet regulations. They depend on where you live, how much of your identity we have verified, and any early-access program you are part of.\n\n" +
      "\"No fixed limit\" means your account has no personal cap set. Each route still has its own minimum and maximum per transfer, which you see when you get a quote."
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.headerButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={26} color={send.text} />
        </Pressable>
        <Text accessibilityRole="header" style={s.title}>Transfer Limits</Text>
        <View style={s.headerButton} />
      </View>

      {!limits && !error ? <View style={s.center}><ActivityIndicator color={send.primary} /></View> : null}
      {error ? (
        <View style={s.center}>
          <Text style={s.muted}>{error}</Text>
          {/jurisdiction/i.test(error)
            ? <Pressable accessibilityRole="button" style={{ marginTop: 14 }} onPress={() => router.push("/linqasend/jurisdiction")}><Text style={s.link}>Set up your region</Text></Pressable>
            : <Pressable accessibilityRole="button" style={{ marginTop: 14 }} onPress={() => void load()}><Text style={s.link}>Try again</Text></Pressable>}
        </View>
      ) : null}

      {limits ? (
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.heading}>Your Limits <Text style={s.headingSub}>({currency})</Text></Text>

          <LimitsGauge
            share={share}
            centerTop={usd(daily.usedMinor)}
            centerBottom={daily.limitMinor === null ? "sent in the last 24 hours" : `of ${usd(daily.limitMinor)}`}
          />
          {share === null ? <Text style={s.noLimit}>No daily limit is set on your account.</Text> : null}

          <View style={s.group}>
            <Row label="Daily Limit" value={maybe(daily.limitMinor, "No fixed limit")} strong />
            <Row label="Daily Used" value={usd(daily.usedMinor)} />
            <Row label="Daily Remaining" value={maybe(daily.remainingMinor, "—")} />
          </View>
          <View style={s.divider} />
          <View style={s.group}>
            <Row label="Monthly Limit" value={maybe(monthly.limitMinor, "No fixed limit")} strong />
            <Row label="Monthly Used" value={usd(monthly.usedMinor)} />
            <Row label="Monthly Remaining" value={maybe(monthly.remainingMinor, "—")} />
          </View>
          {limits.perTransferLimitMinor ? <><View style={s.divider} /><Row label="Per transfer" value={usd(limits.perTransferLimitMinor)} strong /></> : null}
          <View style={s.divider} />

          <Pressable accessibilityRole="button" style={s.learn} onPress={learnMore}>
            <Text style={s.link}>Learn more about limits</Text>
          </Pressable>
        </ScrollView>
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
  link: { color: send.primary, fontFamily: fonts.bold, fontSize: 16 },
  content: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 30 },
  heading: { color: send.text, fontFamily: fonts.bold, fontSize: 17 },
  headingSub: { color: send.muted, fontFamily: fonts.regular, fontSize: 15 },
  noLimit: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, textAlign: "center", marginTop: -6, marginBottom: 10 },
  group: { gap: 16, marginTop: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { color: send.text, fontFamily: fonts.medium, fontSize: 15 },
  rowValue: { color: send.text, fontFamily: fonts.medium, fontSize: 15 },
  rowStrong: { color: send.text, fontFamily: fonts.extrabold, fontSize: 16 },
  divider: { height: 1, backgroundColor: send.border, marginVertical: 20 },
  learn: { alignItems: "center", paddingVertical: 10 }
});
