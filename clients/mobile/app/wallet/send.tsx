import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { wallet, WalletHeader, WalletTabBar, moneyText, currencySymbol } from "../../components/wallet/theme";
import { getApiBaseUrl } from "../../config/api";
import { WalletService, type WalletBalance, type WalletMoneyQuote, type WalletMoneyTarget } from "../../services/wallet.service";
import { accessTokenProvider } from "../../services/session";
import { parseMoney } from "../../services/send-money-validation";
import { formatAmount } from "../../services/wallet-format";
import { isNetworkError, walletFailure, type WalletFailure, type WalletFailureAction } from "../../services/wallet-errors";
import { estimateFee, type FeeSchedules } from "../../services/wallet-fees";
import { STATUS_LABEL, statusKey } from "../../services/wallet-activity";
import { fonts } from "../../theme/tokens";
import { useWalletDemo } from "../../services/wallet-demo-mode";
import { useAccounts } from "../../account/AccountContext";

type Kind = "INTERNAL" | "EXTERNAL";
type Recipient = WalletMoneyTarget & { kind: Kind };
type Done = { id: string; status: string; to: string; amount: string };

const money = (minor: string, currency: string) => moneyText(minor, currency);
const initials = (name: string) => (name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?");
const usable = (w: WalletBalance) => w.balanceVerified && w.status === "ACTIVE";

/**
 * Send from the wallet: choose a recipient, enter an amount, review the server's quote, confirm with biometrics.
 * Eligibility is decided by the server at the quote; nothing here implies a recipient or rail works before that.
 */
export default function WalletSend() {
  const router = useRouter();
  const { active } = useAccounts();
  const userId = active?.userId;
  const demo = useWalletDemo();
  const owner = useRef(userId);
  owner.current = userId;
  const client = useMemo(() => new WalletService(getApiBaseUrl(), async () => {
    const token = await accessTokenProvider.getAccessToken();
    if (!userId || owner.current !== userId) throw new Error("Account changed. Reopen your wallet.");
    return token;
  }), [userId]);

  const [wallets, setWallets] = useState<WalletBalance[]>([]);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [schedules, setSchedules] = useState<FeeSchedules | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<"offline" | "failed" | null>(null);
  const [reload, setReload] = useState(0);
  const [showRecipients, setShowRecipients] = useState(false);
  const [showWallets, setShowWallets] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [stage, setStage] = useState<"form" | "review" | "done">("form");
  const [quote, setQuote] = useState<WalletMoneyQuote | null>(null);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WalletFailure | null>(null);
  const [info, setInfo] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  // One key per review attempt; cleared when the inputs change or the quote is discarded so a stale quote is never replayed.
  const attempt = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoaded(false); setLoadError(null);
    (async () => {
      try {
        const [balances, internal, external, hasPending] = await Promise.all([
          client.balances(),
          client.targets("INTERNAL").catch((e) => e as Error),
          client.targets("EXTERNAL").catch((e) => e as Error),
          client.pending()
        ]);
        if (!live) return;
        if (internal instanceof Error && external instanceof Error) throw internal;
        const list: Recipient[] = [
          ...("items" in internal ? internal.items.map((t) => ({ ...t, kind: "INTERNAL" as const })) : []),
          ...("items" in external ? external.items.map((t) => ({ ...t, kind: "EXTERNAL" as const })) : [])
        ];
        setWallets(balances.items); setRecipients(list); setPending(!!hasPending);
        setWalletId((cur) => (cur && balances.items.some((w) => w.id === cur && usable(w)) ? cur : balances.items.find(usable)?.id ?? null));
        setLoaded(true);
      } catch (e) { if (live) { setLoadError(isNetworkError(e) ? "offline" : "failed"); setLoaded(true); } }
    })();
    return () => { live = false; };
  }, [client, reload, demo]);

  useEffect(() => {
    let live = true;
    // A failed fetch only hides the estimate; the review step still shows the server's fee.
    client.fees().then((r) => { if (live) setSchedules(r.schedules); }).catch(() => { if (live) setSchedules(null); });
    return () => { live = false; };
  }, [client]);

  const w = wallets.find((x) => x.id === walletId) ?? null;
  const usableWallets = wallets.filter(usable);
  const minor = w ? parseMoney(amount, w.currency) : null;
  const estimate = w && recipient ? estimateFee(schedules, recipient.kind, w.currency, minor) : null;
  const amountTyped = amount.trim() !== "";
  const invalidAmount = amountTyped && !minor;
  const overBalance = !!minor && !!w && (estimate ? estimate.totalMinor : BigInt(minor)) > BigInt(w.availableMinor);
  const amountError = invalidAmount ? "Enter an amount like 25.00." : overBalance ? (estimate ? "Amount plus fee exceeds your available balance." : "Amount exceeds your available balance.") : failure?.field === "amount" ? failure.message : null;
  const recipientError = failure?.field === "recipient" ? failure.message : null;
  const canReview = !!w && !!recipient && !!minor && !overBalance && !pending && !busy;

  const resetAttempt = () => { attempt.current = null; setFailure((f) => (f?.field ? null : f)); };

  async function review() {
    if (!w || !recipient || !minor) return;
    setBusy(true); setFailure(null); setInfo("");
    try {
      attempt.current ??= `wallet-quote-${Crypto.randomUUID()}`;
      const q = await client.quote({ walletId: w.id, kind: recipient.kind, amountMinor: minor, targetId: recipient.id }, attempt.current);
      if (owner.current === userId) { setQuote(q); setStage("review"); }
    } catch (e) {
      if (owner.current === userId) setFailure(isNetworkError(e) ? { code: null, message: "You're offline.", fix: "Connect to the internet and try again." } : walletFailure(e, "Unable to review this transfer."));
    } finally { setBusy(false); }
  }

  async function confirm(mode: "authorize" | "resume" | "resolve" = "authorize") {
    setBusy(true); setFailure(null); setInfo("");
    const summary = quote && recipient ? { to: recipient.name, amount: money(quote.amountMinor, quote.currency) } : { to: "your recipient", amount: "" };
    try {
      const r = mode === "resolve" ? await client.resolvePending() : mode === "resume" ? await client.resume() : await client.authorize(quote!.id);
      if (owner.current !== userId) return;
      if (note.trim() && mode === "authorize") await client.saveNote(r.id, note).catch(() => undefined);
      attempt.current = null; setPending(false); setQuote(null);
      setDone({ id: r.id, ...summary, status: r.status }); setStage("done");
    } catch (e) {
      if (owner.current !== userId) return;
      setFailure(isNetworkError(e) ? { code: null, message: "We couldn't reach the server.", fix: "Check your connection." } : walletFailure(e, "Unable to confirm."));
      // After a failed submit the outcome may be unknown: keep the action locked until its status is checked.
      setPending(!!(await client.pending().catch(() => null)));
    } finally { setBusy(false); }
  }

  function runFailureAction(action: WalletFailureAction) {
    setFailure(null);
    if (action === "LOAD") router.push({ pathname: "/wallet/money", params: { kind: "TOPUP", ...(walletId ? { walletId } : {}) } });
    else if (action === "LINK") router.push("/wallet/link-bank");
    else if (action === "ACTIVITY") router.push("/wallet/activity");
    else backToForm();
  }

  function backToForm() { attempt.current = null; setQuote(null); setStage("form"); }
  const goBack = () => (stage === "review" && !pending ? backToForm() : router.canGoBack() ? router.back() : router.replace("/wallet"));

  const expired = !!quote && Date.parse(quote.expiresAt) <= Date.now();
  const failureCard = failure && !failure.field ? (
    <View accessibilityRole="alert" style={s.failure}>
      <Text style={s.failureTitle}>{failure.message}</Text>
      {failure.fix ? <Text style={s.muted}>{failure.fix}</Text> : null}
      {failure.action ? (
        <Pressable accessibilityRole="button" style={s.failureAction} onPress={() => runFailureAction(failure.action!)}>
          <Text style={s.failureActionText}>{{ LOAD: "Load wallet", LINK: "Link an account", REVIEW: "Review again", ACTIVITY: "View activity" }[failure.action]}</Text>
        </Pressable>
      ) : null}
    </View>
  ) : null;

  const header = (
    <WalletHeader title={stage === "review" ? "Review" : "Send"} onBack={goBack}>
      <View style={s.identityRow}><Ionicons name="cube-outline" size={18} color={wallet.teal} /><Text style={s.identityText}>Linqa Wallet</Text></View>
    </WalletHeader>
  );

  // Page-level states
  if (!loaded) return <Shell><View style={s.center}><ActivityIndicator color={wallet.teal} size="large" /><Text style={s.muted}>Loading your wallet…</Text></View></Shell>;
  if (loadError) {
    return (
      <Shell>{header}
        <View style={s.center}>
          <Ionicons name={loadError === "offline" ? "cloud-offline-outline" : "alert-circle-outline"} size={32} color={wallet.danger} />
          <Text style={s.emptyTitle}>{loadError === "offline" ? "You're offline" : "Send is unavailable"}</Text>
          <Text style={s.muted}>{loadError === "offline" ? "Connect to the internet and try again." : "We couldn't load your wallet. Try again in a moment."}</Text>
          <Pressable accessibilityRole="button" style={s.primary} onPress={() => setReload((v) => v + 1)}><Text style={s.primaryText}>Try again</Text></Pressable>
        </View>
      </Shell>
    );
  }
  if (!usableWallets.length && !pending) {
    return (
      <Shell>{header}
        <View style={s.center}>
          <Ionicons name="wallet-outline" size={32} color={wallet.muted} />
          <Text style={s.emptyTitle}>{wallets.length ? "Your wallet isn't ready" : "Open your wallet first"}</Text>
          <Text style={s.muted}>{wallets.length ? "Sending is available once your wallet is active and its balance is verified." : "You need a wallet before you can send money from it."}</Text>
          <Pressable accessibilityRole="button" style={s.primary} onPress={() => router.replace("/wallet")}><Text style={s.primaryText}>Go to Wallet</Text></Pressable>
        </View>
      </Shell>
    );
  }

  if (stage === "done" && done) {
    const sk = statusKey(done.status);
    return (
      <Shell>{header}
        <ScrollView contentContainerStyle={s.content}>
          <View style={[s.card, { alignItems: "center" }]}>
            <View style={[s.check, { borderColor: sk === "COMPLETED" ? wallet.teal : "#F5A524" }]}><Ionicons name={sk === "COMPLETED" ? "checkmark" : "time"} size={34} color={sk === "COMPLETED" ? wallet.teal : "#F5A524"} /></View>
            <Text style={s.cardTitle}>{sk === "COMPLETED" ? "Sent" : "Send in progress"}</Text>
            <Text style={s.muted}>
              {sk === "COMPLETED" ? `${done.amount} was sent to ${done.to}.` : `Your payment to ${done.to} is ${STATUS_LABEL[sk].toLowerCase()}. It shows as ${STATUS_LABEL[sk]} in Activity until it is confirmed.`}
            </Text>
            <View style={s.divider} />
            <View style={s.line}><Text style={s.muted}>Status</Text><Text style={s.value}>{STATUS_LABEL[sk]}</Text></View>
            <Pressable accessibilityRole="button" style={[s.primary, { alignSelf: "stretch" }]} onPress={() => router.replace({ pathname: "/wallet/transaction", params: { id: done.id } })}><Text style={s.primaryText}>View details</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.replace("/wallet")}><Text style={s.link}>Back to Wallet</Text></Pressable>
          </View>
        </ScrollView>
      </Shell>
    );
  }

  return (
    <Shell>
      {header}
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {pending ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>We're checking your last send</Text>
            <Text style={s.muted}>We couldn't confirm the result of your last send. Don't send again until its status is checked. If it was never submitted, checking cancels the unused approval.</Text>
            <Pressable accessibilityRole="button" disabled={busy} style={[s.primary, busy && s.disabled]} onPress={() => void confirm("resolve")}><Text style={s.primaryText}>Check status</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void confirm("resume")}><Text style={s.link}>Resume the send</Text></Pressable>
          </View>
        ) : stage === "review" && quote ? (
          <View style={s.card}>
            <View style={s.line}><Text style={s.muted}>To</Text><Text style={s.value}>{recipient?.name}</Text></View>
            <View style={s.line}><Text style={s.muted}>Amount</Text><Text style={s.value}>{money(quote.amountMinor, quote.currency)}</Text></View>
            <View style={s.line}><Text style={s.muted}>Fee</Text><Text style={s.value}>{BigInt(quote.feeMinor) === 0n ? "Free" : money(quote.feeMinor, quote.currency)}</Text></View>
            <View style={[s.line, s.totalLine]}><Text style={s.value}>Total from wallet</Text><Text style={s.value}>{money(quote.totalMinor, quote.currency)}</Text></View>
            {quote.receiveCurrency !== quote.currency ? <View style={s.line}><Text style={s.muted}>Recipient gets</Text><Text style={s.value}>{money(quote.receiveAmountMinor, quote.receiveCurrency)}</Text></View> : null}
            {quote.receiveCurrency !== quote.currency ? <View style={s.line}><Text style={s.muted}>Rate</Text><Text style={s.value}>{quote.fxRate}</Text></View> : null}
            <View style={s.line}><Text style={s.muted}>Funding source</Text><Text style={s.value}>Linqa Wallet ({quote.currency})</Text></View>
            <View style={s.line}><Text style={s.muted}>Estimated delivery</Text><Text style={s.value}>{quote.estimatedArrival}</Text></View>
            {note.trim() ? <View style={s.line}><Text style={s.muted}>Private note</Text><Text style={s.value}>{note.trim()}</Text></View> : null}
            <Text style={s.mutedSmall}>{expired ? "This quote expired." : `Quote valid until ${new Date(quote.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`}</Text>
            {expired ? (
              <Pressable accessibilityRole="button" style={s.primary} onPress={backToForm}><Text style={s.primaryText}>Review again</Text></Pressable>
            ) : (
              <Pressable accessibilityRole="button" disabled={busy} style={[s.primary, busy && s.disabled]} onPress={() => void confirm()}>
                <Ionicons name="finger-print" size={18} color={wallet.onTeal} /><Text style={s.primaryText}>Confirm with biometrics</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" disabled={busy} onPress={backToForm}><Text style={s.link}>Change details</Text></Pressable>
          </View>
        ) : (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel={recipient ? `Recipient ${recipient.name}. Change recipient` : "Choose a recipient"} accessibilityState={{ expanded: showRecipients }} style={[s.card, s.rowCard, recipientError ? s.cardError : null]} onPress={() => setShowRecipients((v) => !v)}>
              {recipient ? <View style={s.avatar}><Text style={s.avatarText}>{initials(recipient.name)}</Text></View> : <View style={[s.avatar, { backgroundColor: wallet.raised }]}><Ionicons name="person-add-outline" size={16} color={wallet.teal} /></View>}
              <View style={{ flex: 1 }}>
                <Text style={s.recipientName}>{recipient ? recipient.name : "Choose a recipient"}</Text>
                <Text style={s.muted}>{recipient ? (recipient.kind === "INTERNAL" ? "Linqa contact" : "Outside Linqa") : "Linqa contact or another recipient"}</Text>
              </View>
              <Ionicons name={showRecipients ? "chevron-down" : "chevron-forward"} size={16} color={wallet.muted} />
            </Pressable>
            {recipientError ? <Text accessibilityRole="alert" style={s.fieldError}>{recipientError}</Text> : null}
            {showRecipients ? (
              <View style={s.card}>
                {recipients.length ? recipients.map((r) => (
                  <Pressable key={`${r.kind}:${r.id}`} accessibilityRole="radio" accessibilityState={{ checked: recipient?.id === r.id }} style={[s.pickRow, recipient?.id === r.id && s.pickRowOn]} onPress={() => { setRecipient(r); setShowRecipients(false); resetAttempt(); setFailure(null); }}>
                    <View style={s.avatarSmall}><Text style={s.avatarTextSmall}>{initials(r.name)}</Text></View>
                    <View style={{ flex: 1 }}><Text style={s.pickName} numberOfLines={1}>{r.name}</Text><Text style={s.muted}>{r.kind === "INTERNAL" ? "Linqa contact" : "Outside Linqa"} · {r.currency}</Text></View>
                    {recipient?.id === r.id ? <Ionicons name="checkmark-circle" size={16} color={wallet.teal} /> : null}
                  </Pressable>
                )) : <Text style={s.muted}>You have no saved recipients yet.</Text>}
                <Pressable accessibilityRole="button" style={s.addRow} onPress={() => router.push("/linqasend/recipients")}><Ionicons name="add-circle-outline" size={18} color={wallet.teal} /><Text style={s.link}>Add or manage recipients</Text></Pressable>
              </View>
            ) : null}

            <View style={s.amountBlock}>
              <Text style={s.muted}>Amount{w ? ` (${w.currency})` : ""}</Text>
              <View style={s.amountRow}>
                <Text style={s.amountSymbol}>{w ? currencySymbol(w.currency) : ""}</Text>
                <TextInput accessibilityLabel="Amount" accessibilityHint={amountError ?? undefined} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={wallet.faint} value={amount} onChangeText={(v) => { attempt.current = null; setFailure(null); setAmount(v); }} style={[s.amountInput, amountError ? { color: wallet.danger } : null]} />
              </View>
              {w ? <Text style={s.muted}>Available <Text style={{ color: wallet.teal, fontFamily: fonts.semibold }}>{money(w.availableMinor, w.currency)}</Text></Text> : null}
              {amountError ? <Text accessibilityRole="alert" style={s.fieldError}>{amountError}</Text> : null}
            </View>

            <Pressable accessibilityRole="button" accessibilityLabel="Funding source" accessibilityState={{ expanded: showWallets }} disabled={usableWallets.length < 2} style={[s.card, s.rowCard]} onPress={() => setShowWallets((v) => !v)}>
              <View style={[s.avatar, { backgroundColor: wallet.bg, borderWidth: 1, borderColor: wallet.raised }]}><Ionicons name="cube-outline" size={30} color={wallet.teal} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.recipientName}>Linqa Wallet{w ? ` · ${w.currency}` : ""}</Text>
                <Text style={s.muted}>{w ? `Balance ${money(w.availableMinor, w.currency)}` : "No active wallet"}</Text>
              </View>
              {usableWallets.length > 1 ? <Ionicons name={showWallets ? "chevron-up" : "chevron-down"} size={16} color={wallet.muted} /> : null}
            </Pressable>
            {showWallets ? (
              <View style={s.card}>
                {usableWallets.map((x) => (
                  <Pressable key={x.id} accessibilityRole="radio" accessibilityState={{ checked: x.id === walletId }} style={[s.pickRow, x.id === walletId && s.pickRowOn]} onPress={() => { setWalletId(x.id); setShowWallets(false); resetAttempt(); }}>
                    <View style={{ flex: 1 }}><Text style={s.pickName} numberOfLines={1}>Linqa Wallet · {x.currency}</Text><Text style={s.muted}>Balance {money(x.availableMinor, x.currency)}</Text></View>
                    {x.id === walletId ? <Ionicons name="checkmark-circle" size={16} color={wallet.teal} /> : null}
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={[s.card, s.feeCard]} accessibilityLabel="Fee and delivery estimate">
              <View style={s.feeCell}>
                <View style={s.feeIcon}><Ionicons name="cash-outline" size={16} color={wallet.teal} /></View>
                <View style={s.feeText}><Text style={s.muted}>Fee{w ? ` · ${w.currency}` : ""}</Text><Text style={s.feeValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{estimate && w ? formatAmount(estimate.feeMinor.toString(), w.currency) : "At review"}</Text></View>
              </View>
              <View style={s.feeDivider} />
              <View style={s.feeCell}>
                <View style={s.feeIcon}><Ionicons name="flash-outline" size={16} color={wallet.teal} /></View>
                <View style={s.feeText}><Text style={s.muted}>Arrives</Text><Text style={s.feeValue} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>{!recipient ? "—" : recipient.kind === "INTERNAL" ? "On approval" : "At review"}</Text></View>
              </View>
            </View>
            {estimate && w && recipient ? (
              <Text style={s.mutedSmall}>
                {estimate.minimumApplied ? "Minimum fee applies. " : ""}You'll be charged {money(estimate.totalMinor.toString(), w.currency)} in total. This is an estimate; the final fee is shown at review{recipient.kind === "EXTERNAL" ? " and can be higher if the provider charges more" : ""}.
              </Text>
            ) : null}

            <View style={s.card}>
              <Text style={s.muted}>Private note (optional)</Text>
              <TextInput accessibilityLabel="Private note" value={note} onChangeText={setNote} maxLength={140} placeholder="Add a private note…" placeholderTextColor={wallet.faint} style={s.noteInput} />
              <Text style={s.mutedSmall}>Only you see this, and it stays on this device.</Text>
            </View>

            {failureCard}
            {info ? <Text style={s.muted}>{info}</Text> : null}

            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canReview }} disabled={!canReview} style={[s.primary, !canReview && s.disabled]} onPress={() => void review()}>
              {busy ? <ActivityIndicator color={wallet.onTeal} /> : <Text style={s.primaryText}>{minor && w ? `Review ${money(minor, w.currency)}` : "Review transfer"}</Text>}
            </Pressable>
            <View style={s.secure}><Ionicons name="lock-closed-outline" size={16} color={wallet.teal} /><Text style={s.muted}>Review transfer · confirm with biometrics</Text></View>
          </>
        )}
        {stage === "review" || pending ? failureCard : null}
      </ScrollView>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <SafeAreaView style={s.screen}><StatusBar style="light" />{children}<WalletTabBar active="send" /></SafeAreaView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: wallet.bg },
  identityRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  identityText: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.muted },
  content: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 10, gap: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 28 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 17, color: wallet.text, textAlign: "center" },
  card: { backgroundColor: wallet.card, borderColor: wallet.raised, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  cardError: { borderColor: wallet.danger },
  cardTitle: { fontFamily: fonts.bold, fontSize: 16, color: wallet.text },
  rowCard: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#2A3B52", alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.bold, fontSize: 15, color: wallet.text },
  avatarSmall: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#2A3B52", alignItems: "center", justifyContent: "center" },
  avatarTextSmall: { fontFamily: fonts.bold, fontSize: 13, color: wallet.text },
  recipientName: { fontFamily: fonts.bold, fontSize: 16, color: wallet.text },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 46, paddingVertical: 4, borderRadius: 10 },
  pickName: { fontFamily: fonts.semibold, fontSize: 14, color: wallet.text },
  pickRowOn: { backgroundColor: wallet.raised },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 38 },
  amountBlock: { alignItems: "center", gap: 2, paddingVertical: 2 },
  amountRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  amountSymbol: { fontFamily: fonts.extrabold, fontSize: 34, color: wallet.text },
  amountInput: { fontFamily: fonts.extrabold, fontSize: 34, color: wallet.text, minWidth: 100, textAlign: "center", paddingVertical: 2 },
  fieldError: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, color: wallet.danger },
  feeCard: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  feeCell: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  feeText: { flex: 1, minWidth: 0 },
  feeIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: wallet.tealSoft, alignItems: "center", justifyContent: "center" },
  feeValue: { fontFamily: fonts.bold, fontSize: 15, color: wallet.text },
  feeDivider: { width: 1, alignSelf: "stretch", backgroundColor: wallet.raised, marginHorizontal: 8 },
  noteInput: { fontFamily: fonts.regular, fontSize: 14, color: wallet.text, borderWidth: 1, borderColor: wallet.raised, borderRadius: 8, paddingHorizontal: 12, minHeight: 40 },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, minHeight: 30 },
  totalLine: { borderTopWidth: 1, borderTopColor: wallet.raised, paddingTop: 6 },
  value: { fontFamily: fonts.semibold, fontSize: 14, color: wallet.text, flexShrink: 1, textAlign: "right" },
  divider: { height: 1, alignSelf: "stretch", backgroundColor: wallet.raised },
  check: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  muted: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: wallet.muted },
  mutedSmall: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, color: wallet.muted },
  primary: { flexDirection: "row", gap: 8, backgroundColor: wallet.teal, borderRadius: 999, minHeight: 44, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  primaryText: { fontFamily: fonts.bold, fontSize: 15, color: wallet.onTeal },
  disabled: { opacity: 0.5 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.teal, paddingVertical: 6 },
  secure: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  failure: { backgroundColor: wallet.card, borderColor: wallet.danger, borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  failureTitle: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: wallet.text },
  failureAction: { alignSelf: "flex-start", borderWidth: 1, borderColor: wallet.teal, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginTop: 2 },
  failureActionText: { fontFamily: fonts.semibold, fontSize: 12, color: wallet.teal }
});
