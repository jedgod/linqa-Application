import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinqaSendStatusBar, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { LinqaSendApiError, LinqaSendService, type LinqaSendDepositOptions, type LinqaSendDepositResult, type LinqaSendPaymentMethod } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { displayMoney } from "../../services/send-money-validation";
import { fonts } from "../../theme/tokens";
import { useAccounts } from "../../account/AccountContext";

const API = getApiBaseUrl();
const DESTINATION_TYPES = ["BANK_ACCOUNT", "DEBIT_CARD"];
const METHOD_NAME: Record<string, string> = { BANK_ACCOUNT: "Bank account", DEBIT_CARD: "Debit card" };
const MESSAGES: Record<string, string> = {
  WALLET_INSUFFICIENT_FUNDS: "The available wallet balance is too low. Some funds may already be held.",
  WALLET_NOT_ACTIVE: "This wallet is not available for withdrawals.",
  wallet_receipt_not_verified: "The provider has not confirmed this receipt as wallet funds.",
  withdrawal_provider_not_ready: "Withdrawals are not available in this environment.",
  withdrawal_details_changed: "Withdrawal details changed. Review the amount and authorize again.",
  transfer_not_found: "We couldn't find this transfer.",
  transfer_not_completed: "This transfer isn't complete yet.",
  deposit_already_chosen: "You've already chosen how to deposit this money.",
  deposit_destination_required: "Choose a verified bank account or debit card.",
  instant_deposit_unavailable: "The amount is too small for an instant deposit.",
  deposit_provider_failed: "The deposit couldn't be sent right now. Check your wallet for the latest status before trying again.",
  device_bound_fresh_session_required: "Please sign in again to move money."
};

const friendlyDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

/**
 * Deposit from wallet: received money always lands in the receiver's Linqa wallet. The receiver decides here how to move it to a
 * bank account or debit card on file: instantly (free if the sender covered the instant fee, otherwise a fee comes out of the
 * deposit) or free after 3 business days.
 */
export default function LinqaSendDeposit() {
  const router = useRouter();
  const { active: account } = useAccounts();
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [data, setData] = useState<LinqaSendDepositOptions | null>(null);
  const [methods, setMethods] = useState<LinqaSendPaymentMethod[] | null>(null);
  const [choice, setChoice] = useState<"instant" | "standard">("standard");
  const [destination, setDestination] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<LinqaSendDepositResult | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);setMethods(null);setDestination(null);setDone(null);setError(null);
    Promise.all([client.depositOptions(id), client.listPaymentMethods()]).then(([options, list]) => {
      if (!active) return;
      const eligible = list.items.filter((m) => m.verificationStatus === "VERIFIED" && DESTINATION_TYPES.includes(m.type));
      setData(options);
      setMethods(eligible);
      setDestination(eligible[0]?.id ?? null);
      setChoice(options.options.instant.available && options.senderPaidInstantFee ? "instant" : "standard");
    }).catch((cause) => { if (active) setError(describe(cause)); });
    return () => { active = false; };
  }, [client, id, account?.userId]);

  async function confirm() {
    if (!data || !destination || busy) return;
    setBusy(true);
    setError(null);
    try {


      setDone(await client.requestDeposit(id, { option: choice, paymentMethodId: destination }));
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }

  const money = (minor: string) => `${displayMoney(minor, data?.currency ?? "USD")} ${data?.currency ?? ""}`;

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.headerButton} onPress={() => (router.canGoBack() ? router.back() : router.replace("/linqasend/history"))}>
          <Ionicons name="arrow-back" size={26} color={send.text} />
        </Pressable>
        <Text accessibilityRole="header" style={s.title}>Withdraw to bank or card</Text>
        <View style={s.headerButton} />
      </View>

      {!data && !error ? <View style={s.center}><ActivityIndicator color={send.primary} /></View> : null}
      {error && !data ? <View style={s.center}><Text style={s.error}>{error}</Text></View> : null}

      {done ? (
        <View style={s.center}>
          <Ionicons name="checkmark-circle" size={64} color={send.success} />
          <Text style={s.doneTitle}>{done.releaseOn ? "Withdrawal scheduled" : "Withdrawal queued"}</Text>
          <Text style={s.help}>
            {done.status === "SCHEDULED" && done.releaseOn
              ? `${money(done.netDepositMinor)} is scheduled for processing from ${friendlyDate(done.releaseOn)}. Bank arrival may be later.`
              : `${money(done.netDepositMinor)} is queued for processing. Check your wallet for its status.`}
          </Text>
          <Pressable accessibilityRole="button" style={[s.confirm, { alignSelf: "stretch", marginTop: 24 }]} onPress={() => router.replace("/linqasend/history")}><Text style={s.confirmText}>Done</Text></Pressable>
        </View>
      ) : data ? (
        <>
          <ScrollView contentContainerStyle={s.content}>
            <Text style={s.help}>{money(data.amountMinor)} is in your Linqa wallet. Choose how to withdraw it.</Text>
            {data.chosen ? <Text style={s.notice}>Withdrawal status: {data.chosen.status.toLowerCase()}. {data.chosen.status === "RECONCILING" ? "We are checking the provider. Do not submit another withdrawal." : "Check your wallet for updates."}</Text> : null}

            <Pressable accessibilityRole="button" accessibilityState={{ selected: choice === "instant", disabled: !data.options.instant.available }} disabled={!data.options.instant.available || !!data.chosen} onPress={() => setChoice("instant")} style={[s.option, choice === "instant" && s.optionOn, !data.options.instant.available && { opacity: 0.45 }]}>
              <Text style={s.optionTitle}>Instant withdrawal</Text>
              <Text style={s.optionLine}>
                {data.options.instant.feePaidBy === "sender" ? "Free: the sender covered the fee." : `Fee ${money(data.options.instant.receiverFeeMinor)} comes out of the deposit.`}
              </Text>
              <Text style={s.optionNet}>You receive {money(data.options.instant.netDepositMinor)}</Text>
              {!data.options.instant.available ? <Text style={s.optionLine}>The amount is too small for an instant deposit.</Text> : null}
            </Pressable>

            <Pressable accessibilityRole="button" accessibilityState={{ selected: choice === "standard" }} disabled={!!data.chosen} onPress={() => setChoice("standard")} style={[s.option, choice === "standard" && s.optionOn]}>
              <Text style={s.optionTitle}>In {data.options.standard.businessDays} business days</Text>
              <Text style={s.optionLine}>Free. Available {friendlyDate(data.options.standard.availableOn)}.</Text>
              <Text style={s.optionNet}>You receive {money(data.options.standard.netDepositMinor)}</Text>
              {data.senderPaidInstantFee ? <Text style={s.optionLine}>Any sender fee refund requires separate confirmation and is not included in this withdrawal.</Text> : null}
            </Pressable>

            <Text style={[s.label, { marginTop: 22 }]}>Withdraw to</Text>
            {methods === null ? <ActivityIndicator color={send.primary} /> : methods.length === 0 ? (
              <Pressable accessibilityRole="button" onPress={() => router.push("/linqasend/payment-methods")}><Text style={s.link}>Add a bank account or debit card</Text></Pressable>
            ) : methods.map((m) => (
              <Pressable key={m.id} accessibilityRole="button" accessibilityState={{ selected: destination === m.id }} onPress={() => setDestination(m.id)} style={[s.dest, destination === m.id && s.optionOn]}>
                <Text style={s.optionTitle}>{METHOD_NAME[m.type] ?? m.type}{m.last4 ? ` •••• ${m.last4}` : ""}</Text>
              </Pressable>
            ))}
            {error ? <Text style={s.error}>{error}</Text> : null}
          </ScrollView>
          <View style={s.footer}>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !destination || busy || !!data.chosen }} disabled={!destination || busy || !!data.chosen} style={[s.confirm, (!destination || busy || !!data.chosen) && { opacity: 0.45 }]} onPress={confirm}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.confirmText}>{choice === "instant" ? "Withdraw now" : "Schedule withdrawal"}</Text>}
            </Pressable>
          </View>
        </>
      ) : null}
    </SafeAreaView>
  );
}

function describe(cause: unknown): string {
  if (cause instanceof LinqaSendApiError && typeof cause.payload.error === "string") return MESSAGES[cause.payload.error] ?? "Something went wrong. Please try again.";
  return cause instanceof Error ? cause.message : "Unable to reach LinqaSend. Check your connection and try again.";
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: send.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: send.text, fontFamily: fonts.extrabold, fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  help: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  notice: { color: send.warning, fontFamily: fonts.medium, fontSize: 14, marginBottom: 12 },
  option: { borderRadius: 16, borderWidth: 1.5, borderColor: send.border, padding: 16, marginBottom: 12 },
  optionOn: { borderColor: send.primary, backgroundColor: "#EEF0FF" },
  optionTitle: { color: send.text, fontFamily: fonts.bold, fontSize: 16 },
  optionLine: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginTop: 4 },
  optionNet: { color: send.text, fontFamily: fonts.semibold, fontSize: 15, marginTop: 8 },
  label: { color: send.text, fontFamily: fonts.bold, fontSize: 15, marginBottom: 10 },
  dest: { borderRadius: 14, borderWidth: 1.5, borderColor: send.border, padding: 14, marginBottom: 10 },
  link: { color: send.primary, fontFamily: fonts.semibold, fontSize: 15 },
  error: { color: send.danger, fontFamily: fonts.medium, fontSize: 14, marginTop: 14 },
  doneTitle: { color: send.text, fontFamily: fonts.extrabold, fontSize: 20, marginTop: 16, marginBottom: 8 },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  confirm: { height: 56, borderRadius: 16, backgroundColor: send.primary, alignItems: "center", justifyContent: "center" },
  confirmText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 16 }
});
