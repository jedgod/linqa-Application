import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WalletService, type WalletMoneyKind, type WalletMoneyQuote } from "../../services/wallet.service";
import { accessTokenProvider } from "../../services/session";
import { getApiBaseUrl } from "../../config/api";
import { useAccounts } from "../../account/AccountContext";
import { displayMoney, parseMoney } from "../../services/send-money-validation";
import { wallet, WalletHeader, WalletTabBar, moneyText, currencySymbol } from "../../components/wallet/theme";
import { walletFailure, type WalletFailure, type WalletFailureAction } from "../../services/wallet-errors";
import { fonts } from "../../theme/tokens";
import { useWalletDemo } from "../../services/wallet-demo-mode";

const money = (minor: string, currency: string) => moneyText(minor, currency);

type Done = { id: string; status: string; kind: WalletMoneyKind; from: string; amount: string };

/** Load Wallet (LinqaSend -> wallet) and Cash Out (wallet -> your bank). Sending to people is /wallet/send. */
export default function WalletMoney() {
  const router = useRouter();
  const params = useLocalSearchParams<{ walletId?: string; kind?: string }>();
  const { active } = useAccounts();
  const userId = active?.userId;
  const demo = useWalletDemo();
  const owner = useRef(userId);
  owner.current = userId;
  const [kind, setKind] = useState<WalletMoneyKind>(params.kind === "TOPUP" ? "TOPUP" : "WITHDRAW");
  const sendRequested = params.kind === "INTERNAL" || params.kind === "EXTERNAL";
  useEffect(() => { if (sendRequested) router.replace("/wallet/send"); }, [sendRequested, router]);
  const loading = kind === "TOPUP";
  const client = useMemo(() => new WalletService(getApiBaseUrl(), async () => {
    const token = await accessTokenProvider.getAccessToken();
    if (!userId || owner.current !== userId) throw new Error("Account changed. Reopen your wallet.");
    return token;
  }), [userId]);
  const [w, setW] = useState<{ id: string; currency: string; availableMinor: string; withdrawableMinor: string } | null>(null);
  const [targets, setTargets] = useState<Array<{ id: string; name: string; currency: string; type: string }>>([]);
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<WalletMoneyQuote | null>(null);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState<WalletFailure | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [copied, setCopied] = useState(false);
  // One key per review attempt. Cleared whenever the inputs change or the quote is discarded, so it never replays a stale quote.
  const attempt = useRef<string | null>(null);

  useEffect(() => {
    let current = true;
    attempt.current = null; setW(null); setQuote(null); setMessage(""); setFailure(null); setTarget(""); setTargets([]); setPending(false); setAmount(""); setDone(null);
    Promise.all([client.balances(), client.targets(kind), client.pending()]).then(([wallets, t, p]) => {
      if (!current) return;
      const usable = (x: (typeof wallets.items)[number]) => x.balanceVerified && x.status === "ACTIVE";
      setW(wallets.items.find((x) => x.id === params.walletId && usable(x)) ?? (params.walletId ? null : wallets.items.find(usable) ?? null));
      setTargets(t.items);
      setPending(!!p);
      if (!wallets.items.some(usable) || (params.walletId && !wallets.items.some((x) => x.id === params.walletId))) setMessage("Open an active wallet first.");
    }).catch((e) => { if (current) setFailure(walletFailure(e, "Unable to load this wallet.")); });
    return () => { current = false; };
  }, [client, kind, params.walletId, demo]);

  const minor = w ? parseMoney(amount, w.currency) : null;
  const overBalance = !!minor && !!w && kind !== "TOPUP" && BigInt(minor) > BigInt(w.availableMinor);
  const chosen = targets.find((t) => t.id === target);

  async function preview() {
    if (!w) return;
    if (!minor || !target) { setMessage("Enter a positive amount and choose an account or recipient."); return; }
    setBusy(true); setMessage(""); setFailure(null);
    try {
      attempt.current ??= `wallet-quote-${Crypto.randomUUID()}`;
      const q = await client.quote({ walletId: w.id, kind, amountMinor: minor, targetId: target }, attempt.current);
      if (owner.current === userId) setQuote(q);
    } catch (e) { if (owner.current === userId) setFailure(walletFailure(e, "Unable to quote this action.")); } finally { setBusy(false); }
  }

  async function confirm(resume = false, resolve = false) {
    setBusy(true); setMessage(""); setFailure(null);
    const summary = quote && { amount: money(quote.amountMinor, quote.currency), from: chosen?.name ?? "" };
    try {
      const r = resolve ? await client.resolvePending() : resume ? await client.resume() : await client.authorize(quote!.id);
      if (owner.current === userId) {
        attempt.current = null; setPending(false); setQuote(null);
        if (summary && !resume && !resolve) setDone({ id: r.id, status: r.status, kind, ...summary });
        else setMessage(`Status: ${r.status.toLowerCase()}. Reference: ${r.id}. Check your wallet for updates.`);
      }
    } catch (e) {
      if (owner.current === userId) {
        setFailure(walletFailure(e, "Unable to confirm."));
        setMessage("Check the wallet status before starting another action.");
        setPending(!!await client.pending());
      }
    } finally { setBusy(false); }
  }

  function runFailureAction(action: WalletFailureAction) {
    setFailure(null);
    if (action === "LOAD") setKind("TOPUP");
    else if (action === "LINK") router.push("/wallet/link-bank");
    else if (action === "ACTIVITY") router.push("/wallet/activity");
    else { attempt.current = null; setQuote(null); }
  }

  async function copyReference(id: string) {
    await Clipboard.setStringAsync(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const title = loading ? "Load Wallet" : "Cash Out";
  const cta = !minor || !w ? (loading ? "Load to Wallet" : "Cash Out") : `${loading ? "Load" : "Cash Out"} ${money(minor, w.currency)}${loading ? " to Wallet" : ""}`;

  return (
    <SafeAreaView style={s.page}>
      <StatusBar style="light" />
      <WalletHeader title={title} onBack={() => (router.canGoBack() ? router.back() : router.replace("/wallet"))}>
        <View style={s.logo}><Ionicons name={loading ? "arrow-down" : "arrow-up"} size={16} color={wallet.onTeal} /></View>
      </WalletHeader>

      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {!w && !message ? <ActivityIndicator color={wallet.teal} /> : null}

        {w && !loading && !done ? (
          <View style={s.card}>
            <Text style={s.muted}>Available Wallet balance</Text>
            <Text style={s.balance}>{money(w.availableMinor, w.currency)}</Text>
          </View>
        ) : null}

        {done ? (
          <View style={[s.card, { alignItems: "center" }]}>
            <View style={s.check}><Ionicons name="checkmark" size={34} color={wallet.teal} /></View>
            <Text style={s.cardTitle}>{done.kind === "TOPUP" ? "Load to Wallet Initiated" : done.kind === "WITHDRAW" ? "Cash Out Initiated" : "Send Initiated"}</Text>
            <Text style={s.muted}>
              {done.kind === "TOPUP" ? "Funds are added after the provider confirms settlement." : `Status: ${done.status.toLowerCase().replace(/_/g, " ")}. Check your wallet for updates.`}
            </Text>
            <View style={s.divider} />
            <View style={s.line}><Text style={s.muted}>{done.kind === "TOPUP" ? "From" : "To"}</Text><Text style={s.value}>{done.from}</Text></View>
            <View style={s.line}><Text style={s.muted}>Amount</Text><Text style={s.value}>{done.amount}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Copy reference ID" style={s.reference} onPress={() => void copyReference(done.id)}>
              <Text style={s.muted}>Reference ID: {done.id.slice(0, 13).toUpperCase()}</Text>
              <Ionicons name={copied ? "checkmark" : "copy-outline"} size={18} color={wallet.teal} />
            </Pressable>
            <Pressable accessibilityRole="button" style={[s.cta, { alignSelf: "stretch" }]} onPress={() => router.replace("/wallet")}>
              <Text style={s.ctaText}>Back to Wallet</Text>
            </Pressable>
          </View>
        ) : pending ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>Action waiting</Text>
            <Text style={s.muted}>Check its status before starting another. If it was never submitted, checking cancels the unused authorization.</Text>
            <Pressable accessibilityRole="button" disabled={busy} style={s.cta} onPress={() => void confirm(true)}><Text style={s.ctaText}>Resume pending wallet action</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void confirm(false, true)}><Text style={s.link}>Check pending action</Text></Pressable>
          </View>
        ) : quote ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>Review</Text>
            <View style={s.line}><Text style={s.muted}>Amount</Text><Text style={s.value}>{money(quote.amountMinor, quote.currency)}</Text></View>
            <View style={s.line}><Text style={s.muted}>Fee</Text><Text style={s.value}>{BigInt(quote.feeMinor) === 0n ? "Free" : money(quote.feeMinor, quote.currency)}</Text></View>
            <View style={s.line}><Text style={s.muted}>{loading ? "Charged to your account" : "Total from wallet"}</Text><Text style={s.value}>{money(quote.totalMinor, quote.currency)}</Text></View>
            <View style={s.line}><Text style={s.muted}>{loading ? "Wallet receives" : "Recipient receives"}</Text><Text style={s.value}>{money(quote.receiveAmountMinor, quote.receiveCurrency)}</Text></View>
            <Text style={s.muted}>Rate {quote.fxRate} · Estimated arrival {quote.estimatedArrival}. Quote expires {new Date(quote.expiresAt).toLocaleTimeString()}.</Text>
            <Pressable accessibilityRole="button" disabled={busy || Date.parse(quote.expiresAt) <= Date.now()} style={[s.cta, (busy || Date.parse(quote.expiresAt) <= Date.now()) && s.disabled]} onPress={() => void confirm()}>
              <Text style={s.ctaText}>Authorize with biometrics</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => { attempt.current = null; setQuote(null); }}><Text style={s.link}>Change details</Text></Pressable>
          </View>
        ) : (
          <>
            {loading ? (
              <View style={s.card}>
                <View style={s.sourceRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.muted}>From: <Text style={s.source}>LinqaSend</Text></Text>
                    <Text style={s.muted}>{chosen ? chosen.name : "Choose a linked account below"}</Text>
                  </View>
                  <View style={s.sourceBadge}><Ionicons name="paper-plane" size={24} color="#2563EB" /></View>
                </View>
              </View>
            ) : null}

            <Text style={s.label}>Amount{w ? ` (${w.currency})` : ""}</Text>
            <View style={s.inputWrap}>
              <Text style={s.dollar}>{w ? currencySymbol(w.currency) : ""}</Text>
              <TextInput
                accessibilityLabel="Amount"
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={wallet.faint}
                value={amount}
                onChangeText={(v) => { attempt.current = null; setAmount(v); }}
                style={s.input}
              />
              {kind === "WITHDRAW" && w ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Use full available amount" style={s.all} onPress={() => setAmount(displayMoney(w.withdrawableMinor, w.currency).replace(/,/g, ""))}>
                  <Text style={s.allText}>All</Text>
                </Pressable>
              ) : minor ? <Ionicons name="checkmark-circle-outline" size={28} color={wallet.teal} /> : null}
            </View>

            <Text style={s.label}>{loading ? "Pay from" : kind === "WITHDRAW" ? "Destination" : "Recipient"}</Text>
            {targets.map((t) => {
              const on = target === t.id;
              return (
                <Pressable key={t.id} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[s.option, on && s.optionOn]} onPress={() => { attempt.current = null; setTarget(t.id); }}>
                  <View style={s.optionIcon}><Ionicons name="business-outline" size={26} color={on ? wallet.teal : wallet.muted} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.optionTitle}>{t.name}</Text>
                    <Text style={s.muted}>{t.currency}</Text>
                  </View>
                  <View style={[s.radio, on && s.radioOn]}>{on ? <View style={s.radioDot} /> : null}</View>
                </Pressable>
              );
            })}
            {w && !targets.length ? <Text style={s.muted}>No eligible accounts or recipients. Link an account or add a recipient before continuing.</Text> : null}
            <Pressable accessibilityRole="button" onPress={() => router.push(kind === "TOPUP" || kind === "WITHDRAW" ? "/wallet/link-bank" : "/linqasend/recipients")}>
              <Text style={s.link}>{kind === "TOPUP" || kind === "WITHDRAW" ? "Link bank or debit card" : "Manage recipients"}</Text>
            </Pressable>

            {overBalance ? <Text accessibilityRole="alert" style={s.negative}>Amount exceeds your available balance.</Text> : null}
            <Pressable accessibilityRole="button" disabled={busy || !w || !target || !minor || overBalance} style={[s.cta, (busy || !w || !target || !minor || overBalance) && s.disabled]} onPress={() => void preview()}>
              <Text style={s.ctaText}>{cta}</Text>
            </Pressable>
            <View style={s.secure}>
              <Ionicons name={loading ? "shield-checkmark-outline" : "lock-closed-outline"} size={20} color={wallet.teal} />
              <Text style={s.muted}>{loading ? "Funds move from your linked bank/card into Wallet balance" : "Secure, encrypted, and safe."}</Text>
            </View>
          </>
        )}

        {failure ? (
          <View accessibilityRole="alert" style={s.failure}>
            <Text style={s.failureTitle}>{failure.message}</Text>
            {failure.fix ? <Text style={s.muted}>{failure.fix}</Text> : null}
            {failure.action ? (
              <Pressable accessibilityRole="button" style={s.failureAction} onPress={() => runFailureAction(failure.action!)}>
                <Text style={s.failureActionText}>{{ LOAD: "Load wallet", LINK: "Link an account", REVIEW: "Review again", ACTIVITY: "View activity" }[failure.action]}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {message || busy ? <Text accessibilityRole="alert" style={s.message}>{busy ? "Please wait…" : message}</Text> : null}
        {loading && !done ? <Text style={s.muted}>Money becomes available only after the provider confirms settlement. A charge authorization or pending bank payment is not a completed load.</Text> : null}
      </ScrollView>
      <WalletTabBar active="wallet" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: wallet.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 6 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: wallet.text },
  logo: { width: 30, height: 30, borderRadius: 15, backgroundColor: wallet.teal, alignItems: "center", justifyContent: "center" },
  content: { padding: 14, gap: 10 },
  card: { backgroundColor: wallet.card, borderColor: wallet.cardBorder, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 15, color: wallet.text },
  balance: { fontFamily: fonts.extrabold, fontSize: 26, color: wallet.text, letterSpacing: -0.5 },
  muted: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: wallet.muted },
  label: { fontFamily: fonts.regular, fontSize: 12, color: wallet.muted, marginTop: 4 },
  negative: { fontFamily: fonts.medium, fontSize: 13, color: wallet.danger },
  failure: { backgroundColor: wallet.card, borderColor: wallet.danger, borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
  failureTitle: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: wallet.text },
  failureAction: { alignSelf: "flex-start", borderWidth: 1, borderColor: wallet.teal, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginTop: 4 },
  failureActionText: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.teal },
  message: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, color: wallet.text },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  source: { fontFamily: fonts.bold, fontSize: 18, color: wallet.text },
  sourceBadge: { width: 40, height: 40, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 6, borderBottomColor: wallet.teal, borderBottomWidth: 1, paddingHorizontal: 4, minHeight: 48 },
  dollar: { fontFamily: fonts.bold, fontSize: 26, color: wallet.text },
  input: { flex: 1, fontFamily: fonts.bold, fontSize: 26, color: wallet.text, paddingVertical: 6 },
  all: { borderWidth: 1, borderColor: wallet.cardBorder, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: wallet.raised },
  allText: { fontFamily: fonts.bold, fontSize: 13, color: wallet.green },
  option: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: wallet.card, borderColor: wallet.cardBorder, borderWidth: 1, borderRadius: 12, padding: 10 },
  optionOn: { backgroundColor: wallet.card, borderColor: wallet.teal },
  optionIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  optionTitle: { fontFamily: fonts.semibold, fontSize: 14, color: wallet.text },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: wallet.faint, alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: wallet.teal },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: wallet.teal },
  cta: { backgroundColor: wallet.teal, borderRadius: 10, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  ctaText: { fontFamily: fonts.bold, fontSize: 14, color: wallet.onTeal },
  disabled: { opacity: 0.5 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.teal, paddingVertical: 4 },
  secure: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 8 },
  check: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: wallet.teal, alignItems: "center", justifyContent: "center" },
  divider: { height: 1, alignSelf: "stretch", backgroundColor: wallet.cardBorder, marginVertical: 6 },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", alignSelf: "stretch", gap: 12 },
  value: { fontFamily: fonts.semibold, fontSize: 14, color: wallet.text, flexShrink: 1, textAlign: "right" },
  reference: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }
});
