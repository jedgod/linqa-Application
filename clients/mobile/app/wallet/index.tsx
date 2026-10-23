import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { wallet, WalletHeader, WalletTabBar, moneyText } from "../../components/wallet/theme";
import { getApiBaseUrl } from "../../config/api";
import { WalletService, type WalletBalance, type WalletMoneyOperation, type WalletProfile, type WalletReceipt } from "../../services/wallet.service";
import { accessTokenProvider } from "../../services/session";
import { currencyDisplay, countryFlag, formatAmount, formatMinor } from "../../services/wallet-format";
import { describeOperation, isBank, isIncoming, STATUS_LABEL, statusKey } from "../../services/wallet-activity";
import { isNetworkError, walletFailure, type WalletFailure } from "../../services/wallet-errors";
import { fonts } from "../../theme/tokens";
import { setWalletDemo, useWalletDemo, walletDemoAvailable } from "../../services/wallet-demo-mode";
import { useAccounts } from "../../account/AccountContext";

const money = (minor: string, currency: string) => moneyText(minor, currency);
/** "GHS GH₵": the ISO code always, with the locale's symbol when the platform has one. */
const codeLabel = (currency: string) => { const d = currencyDisplay(currency); return d.symbol === d.code ? d.code : `${d.code} ${d.symbol}`; };

function when(iso: string): string {
  const d = new Date(iso), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === new Date(now.getTime() - 86_400_000).toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

const UNAVAILABLE_COPY: Record<string, (country: string) => { title: string; body: string }> = {
  PROFILE_REQUIRED: () => ({ title: "Verify your country first", body: "Wallets are tied to your verified account country. Finish verifying your account to see wallet options." }),
  ENTITY_NOT_ACTIVE: (c) => ({ title: `Wallet service is paused for ${c}`, body: "Wallets can't be opened or used right now. Check back later." }),
  COUNTRY_NOT_SERVED: (c) => ({ title: `Wallets aren't available in ${c} yet`, body: `We recognise ${c}, but Linqa doesn't offer wallet service there yet. Wallet options will appear here when it opens.` })
};

/** Wallet landing page. Everything shown comes from the server; nothing is a sample, and opening a wallet never moves money. */
export default function WalletHome() {
  const router = useRouter();
  const { active } = useAccounts();
  const userId = active?.userId;
  const client = useMemo(() => new WalletService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()), []);
  const [wallets, setWallets] = useState<WalletBalance[] | null>(null);
  const [profile, setProfile] = useState<WalletProfile | null>(null);
  const [profileFailed, setProfileFailed] = useState(false);
  const [ops, setOps] = useState<WalletMoneyOperation[] | null>(null);
  const [opsFailed, setOpsFailed] = useState(false);
  const [receipts, setReceipts] = useState<WalletReceipt[]>([]);
  const [stealth, setStealth] = useState(false);
  const [pageError, setPageError] = useState<"offline" | "failed" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [chosenCurrency, setChosenCurrency] = useState<string | null>(null);
  const [showOpenAnother, setShowOpenAnother] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openFailure, setOpenFailure] = useState<WalletFailure | null>(null);
  const [notice, setNotice] = useState("");
  // A second tap must not start a second request before the first has settled.
  const opening = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    const mine = ++generation.current;
    if (mode === "refresh") setRefreshing(true);
    setPageError(null);
    const [b, p, o, r, sv] = await Promise.allSettled([client.balances(), client.profile(), client.operations({ limit: 5 }), client.receipts(), client.services()]);
    if (mine !== generation.current) return;
    if (b.status === "rejected") {
      setPageError(isNetworkError(b.reason) ? "offline" : "failed");
    } else {
      setWallets(b.value.items);
      setProfile(p.status === "fulfilled" ? p.value : null); setProfileFailed(p.status === "rejected");
      setOps(o.status === "fulfilled" ? o.value.items : null); setOpsFailed(o.status === "rejected");
      setReceipts(r.status === "fulfilled" ? r.value.items : []);
      // Offered only when the server lists it; a failed lookup leaves it switched off rather than guessing.
      setStealth(sv.status === "fulfilled" && sv.value.services.includes("stealthpay"));
    }
    setRefreshing(false);
  }, [client]);

  useFocusEffect(useCallback(() => { void load("initial"); return () => { generation.current++; }; }, [load, userId]));

  // Dev-only sample data (debug builds only): `linqa://wallet?demo=1` or the link at the bottom switches it on.
  const demo = useWalletDemo();
  const params = useLocalSearchParams<{ demo?: string }>();
  useEffect(() => { if (walletDemoAvailable && params.demo === "1") setWalletDemo(true); }, [params.demo]);
  const firstDemoRender = useRef(true);
  useEffect(() => { if (firstDemoRender.current) { firstDemoRender.current = false; return; } void load("refresh"); }, [demo, load]);

  const list = wallets ?? [];
  const w = list[Math.min(selected, Math.max(0, list.length - 1))];
  const usable = !!w && w.status === "ACTIVE" && w.balanceVerified;
  const openable = (profile?.currencies ?? []).filter((c) => c.available && !list.some((x) => x.currency === c.code));
  const currency = chosenCurrency && openable.some((c) => c.code === chosenCurrency) ? chosenCurrency : (openable.find((c) => c.isDefault) ?? openable[0])?.code ?? null;
  const showOpenCard = wallets !== null && profile?.serviceAvailable === true && openable.length > 0 && (list.length === 0 || showOpenAnother);
  const countryName = profile?.country?.name ?? "your country";

  // Why Send / Cash Out / Load are off, in one place so every control explains itself the same way.
  const blockedReason = !wallets ? "" : list.length === 0 ? "Open wallet to enable" : !w ? "" : w.status !== "ACTIVE" ? "Wallet isn't active" : !w.balanceVerified ? "Balance is being verified" : "";

  async function openWallet() {
    if (opening.current || !currency) return;
    opening.current = true;
    setBusy(true); setOpenFailure(null); setNotice("");
    try {
      await client.open(currency);
      setShowOpenAnother(false); setChosenCurrency(null);
      await load("refresh");
      setNotice(`Your ${currency} wallet is open. Opening it didn't move any money.`);
    } catch (e) {
      setOpenFailure(isNetworkError(e) ? { code: null, message: "You're offline.", fix: "Connect to the internet and try again." } : walletFailure(e, "We couldn't open your wallet."));
    } finally { opening.current = false; setBusy(false); }
  }

  const header = (
    <WalletHeader title="Wallet">
      <Pressable accessibilityRole="button" accessibilityLabel="Notifications" hitSlop={8} style={s.iconButton} onPress={() => router.push("/notifications")}>
        <Ionicons name="notifications-outline" size={20} color={wallet.text} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Wallet services" hitSlop={8} style={s.iconButton} onPress={() => router.push("/wallet/more" as never)}>
        <Ionicons name="settings-outline" size={20} color={wallet.teal} />
      </Pressable>
    </WalletHeader>
  );

  if (!wallets && !pageError) {
    return <Shell>{header}<View style={s.center}><ActivityIndicator color={wallet.teal} size="large" /><Text style={s.muted}>Loading your wallet…</Text></View></Shell>;
  }
  if (!wallets && pageError) {
    return (
      <Shell>{header}
        <View style={s.center}>
          <Ionicons name={pageError === "offline" ? "cloud-offline-outline" : "alert-circle-outline"} size={32} color={wallet.danger} />
          <Text style={s.emptyTitle}>{pageError === "offline" ? "You're offline" : "Wallet is unavailable"}</Text>
          <Text style={s.muted}>{pageError === "offline" ? "Connect to the internet and try again." : "We couldn't load your wallet. Try again in a moment."}</Text>
          <Pressable accessibilityRole="button" style={s.primary} onPress={() => void load("initial")}><Text style={s.primaryText}>Try again</Text></Pressable>
        </View>
      </Shell>
    );
  }

  const unavailable = profile && !profile.serviceAvailable ? UNAVAILABLE_COPY[profile.unavailableReason ?? "COUNTRY_NOT_SERVED"]?.(countryName) : null;
  const shownOps = (ops ?? []).slice(0, 2);
  const none = new Map<string, string>();

  const quick: Array<{ icon: keyof typeof Ionicons.glyphMap; line1: string; line2: string; gated: boolean; onPress: () => void }> = [
    { icon: "paper-plane-outline", line1: "Send from", line2: "Wallet", gated: true, onPress: () => router.push("/wallet/send") },
    { icon: "business-outline", line1: "Cash Out", line2: "to Bank", gated: true, onPress: () => w && router.push({ pathname: "/wallet/money", params: { walletId: w.id, kind: "WITHDRAW" } }) },
    { icon: "card-outline", line1: "Cards &", line2: "Passes", gated: false, onPress: () => router.push("/modules/wallet") }
  ];

  return (
    <Shell>
      {header}
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} tintColor={wallet.teal} colors={[wallet.teal]} />}>
        {profile?.country ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Wallet country ${profile.country.name}. View wallets and currencies`} style={s.countryRow} onPress={() => router.push("/wallet/currencies")}>
            <Text style={s.flag}>{countryFlag(profile.country.code)}</Text>
            <Text style={s.countryName}>{profile.country.name}</Text>
            <Text style={s.mutedSmall}>· {profile.country.source === "VERIFIED_PROFILE" ? "Verified profile" : "Account country"}</Text>
            <Ionicons name="chevron-forward" size={16} color={wallet.muted} />
          </Pressable>
        ) : null}

        {profileFailed ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>We couldn't check wallet availability</Text>
            <Text style={s.muted}>Your country and currency options didn't load, so opening a wallet is paused.</Text>
            <Pressable accessibilityRole="button" style={s.secondary} onPress={() => void load("refresh")}><Text style={s.secondaryText}>Retry</Text></Pressable>
          </View>
        ) : unavailable ? (
          <View style={s.card} accessibilityRole="alert">
            <View style={s.unavailableHead}><Text style={s.flagBig}>{countryFlag(profile?.country?.code)}</Text><Text style={[s.cardTitle, { flex: 1 }]}>{unavailable.title}</Text></View>
            <Text style={s.muted}>{unavailable.body}</Text>
            {profile?.currencies.length ? <Text style={s.mutedSmall}>Currency for {countryName}: {profile.currencies.map((c) => codeLabel(c.code)).join(", ")}</Text> : null}
          </View>
        ) : null}

        {showOpenCard ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>{list.length ? "Open another wallet" : "Open your wallet"}</Text>
            <Text style={s.muted}>Opening a wallet lets you receive money or load funds. It doesn't move any money by itself.</Text>
            {profile && profile.defaultCurrency && !profile.currencies.find((c) => c.code === profile.defaultCurrency)?.available ? (
              <Text style={s.mutedSmall}>{countryName}'s currency ({codeLabel(profile.defaultCurrency)}) isn't available yet. Choose one of the currencies below.</Text>
            ) : null}
            <View style={s.chips} accessibilityRole="radiogroup">
              {openable.map((c) => (
                <Pressable key={c.code} accessibilityRole="radio" accessibilityState={{ checked: currency === c.code }} accessibilityLabel={`${c.name}, ${codeLabel(c.code)}`} style={[s.chip, currency === c.code && s.chipOn]} onPress={() => setChosenCurrency(c.code)}>
                  <Text style={[s.chipText, currency === c.code && { color: wallet.onTeal }]}>{codeLabel(c.code)}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !currency }} disabled={busy || !currency} style={[s.primary, (busy || !currency) && s.disabled]} onPress={() => void openWallet()}>
              {busy ? <ActivityIndicator color={wallet.onTeal} /> : <><Text style={s.primaryText}>Open {currency} wallet</Text><Ionicons name="arrow-forward" size={18} color={wallet.onTeal} /></>}
            </Pressable>
            {openFailure ? (
              <View accessibilityRole="alert" style={s.failure}><Text style={s.failureTitle}>{openFailure.message}</Text>{openFailure.fix ? <Text style={s.muted}>{openFailure.fix}</Text> : null}</View>
            ) : null}
          </View>
        ) : null}

        {list.length > 1 ? (
          <View style={s.chips}>
            {list.map((item, i) => (
              <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: i === selected }} style={[s.chip, i === selected && s.chipOn]} onPress={() => setSelected(i)}>
                <Text style={[s.chipText, i === selected && { color: wallet.onTeal }]}>{codeLabel(item.currency)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {w ? (
          <View style={s.balanceCard}>
            <View style={s.balanceHead}>
              <Text style={s.muted}>Cash Balance</Text>
              <View style={s.codePill}><Text style={s.codePillText}>{codeLabel(w.currency)}</Text></View>
              <View style={{ flex: 1 }} />
              {openable.length > 0 && profile?.serviceAvailable && !showOpenAnother ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Open another wallet" hitSlop={8} onPress={() => setShowOpenAnother(true)}><Text style={s.linkSmall}>+ Wallet</Text></Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel={hidden ? "Show balance" : "Hide balance"} hitSlop={10} onPress={() => setHidden((v) => !v)}>
                <Ionicons name={hidden ? "eye-off-outline" : "eye-outline"} size={18} color={wallet.muted} />
              </Pressable>
            </View>
            {!w.balanceVerified ? (
              <Text style={s.muted}>Balance unavailable until this account is reconciled.</Text>
            ) : (
              <>
                <Text accessibilityLabel={hidden ? "Balance hidden" : `${money(w.availableMinor, w.currency)}`} style={s.balance}>
                  {hidden ? "••••••" : `${currencyDisplay(w.currency).symbol === w.currency ? "" : currencyDisplay(w.currency).symbol}${formatMinor(w.availableMinor, w.currency)}`}
                </Text>
                {!hidden && (BigInt(w.pendingMinor) > 0n || BigInt(w.heldMinor) > 0n) ? (
                  <Text style={s.muted}>
                    {BigInt(w.pendingMinor) > 0n ? `Pending ${money(w.pendingMinor, w.currency)}` : ""}
                    {BigInt(w.pendingMinor) > 0n && BigInt(w.heldMinor) > 0n ? " · " : ""}
                    {BigInt(w.heldMinor) > 0n ? `Held ${money(w.heldMinor, w.currency)}` : ""}
                  </Text>
                ) : null}
              </>
            )}
            {w.status !== "ACTIVE" ? <Text style={s.muted}>Account status: {w.status.toLowerCase()}</Text> : null}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !stealth || !usable }}
          accessibilityHint={!stealth ? "Not available yet" : !usable ? blockedReason : undefined}
          disabled={!stealth || !usable}
          style={[s.stealthRow, (!stealth || !usable) && s.dim]}
          onPress={() => router.push("/wallet/stealthpay" as never)}
        >
          <Ionicons name="shield-checkmark-outline" size={20} color={wallet.teal} />
          <View style={{ flex: 1 }}>
            <Text style={s.stealthTitle}>LinqaStealthPay</Text>
            <Text style={s.mutedSmall}>{!stealth ? "Not available yet" : !usable ? blockedReason : "Pay a one-time invoice"}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={wallet.teal} />
        </Pressable>

        <View style={s.twoUp}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !usable }}
            accessibilityHint={!usable ? blockedReason : undefined}
            disabled={!usable}
            style={[s.half, s.halfWide, !usable && s.dim]}
            onPress={() => w && router.push({ pathname: "/wallet/money", params: { walletId: w.id, kind: "TOPUP" } })}
          >
            <Ionicons name="paper-plane-outline" size={18} color={wallet.teal} />
            <Text style={s.halfText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Load from LinqaSend</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Link bank or debit card" style={s.half} onPress={() => router.push("/wallet/link-bank")}>
            <Ionicons name="link-outline" size={18} color={wallet.teal} />
            <Text style={s.halfText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Link bank or card</Text>
          </Pressable>
        </View>
        {!usable && blockedReason ? <Text style={s.mutedSmall}>{blockedReason} before you can load funds.</Text> : null}

        <View style={s.quickRow}>
            {quick.map((q) => {
              const off = q.gated && !usable;
              return (
                <Pressable key={q.line1} accessibilityRole="button" accessibilityLabel={`${q.line1} ${q.line2}`} accessibilityState={{ disabled: off }} accessibilityHint={off ? blockedReason : undefined} disabled={off} style={[s.quick, off && s.dim]} onPress={q.onPress}>
                  <View style={s.quickIcon}>
                    <Ionicons name={q.icon} size={22} color={wallet.teal} />
                    {off ? <View style={s.lock}><Ionicons name="lock-closed" size={11} color={wallet.muted} /></View> : null}
                  </View>
                  <Text style={s.quickText}>{q.line1}{"\n"}{q.line2}</Text>
                  {off ? <Text style={s.quickReason}>{blockedReason}</Text> : null}
                  {!q.gated ? <Ionicons name="chevron-forward" size={14} color={wallet.muted} style={s.quickChevron} /> : null}
                </Pressable>
              );
            })}
          </View>

        <View style={s.card}>
          <View style={s.cardHead}>
            <Text style={s.cardTitle}>Recent Activity</Text>
            {shownOps.length ? <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push("/wallet/activity")}><Text style={s.link}>View All</Text></Pressable> : null}
          </View>
          {opsFailed ? (
            <View style={s.emptyBox}>
              <Text style={s.muted}>Recent activity didn't load.</Text>
              <Pressable accessibilityRole="button" onPress={() => void load("refresh")}><Text style={s.link}>Retry</Text></Pressable>
            </View>
          ) : ops && !shownOps.length ? (
            <View style={s.emptyBox}>
              <Ionicons name="receipt-outline" size={32} color={wallet.muted} />
              <Text style={s.emptyTitleSmall}>No wallet activity yet</Text>
              <Text style={[s.muted, { textAlign: "center" }]}>Your transactions will appear here after your first wallet transaction.</Text>
            </View>
          ) : null}
          {shownOps.map((o, i) => {
            const incoming = isIncoming(o), sk = statusKey(o.status), cur = o.snapshot.currency;
            const amount = incoming ? (o.kind === "TOPUP" ? o.snapshot.receiveAmountMinor : o.snapshot.amountMinor) : o.snapshot.totalMinor;
            const color = incoming ? wallet.teal : wallet.danger;
            return (
              <Pressable key={o.id} accessibilityRole="button" style={[s.opRow, i > 0 && s.opDivider]} onPress={() => router.push({ pathname: "/wallet/transaction", params: { id: o.id } })}>
                <View style={[s.opIcon, { backgroundColor: incoming ? wallet.tealSoft : "#3A1B2A" }]}><Ionicons name={isBank(o) ? "business" : incoming ? "arrow-down" : "arrow-up"} size={18} color={color} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.opTitle, { color }]} numberOfLines={1}>{describeOperation(o, none)}</Text>
                  <Text style={s.mutedSmall}>{when(o.created_at)} · {STATUS_LABEL[sk]}</Text>
                </View>
                <View style={s.opAmountCol}><Text style={[s.opAmount, { color }]} numberOfLines={1}>{incoming ? "+" : "-"}{formatAmount(amount, cur)}</Text><Text style={s.opCode}>{cur}</Text></View>
              </Pressable>
            );
          })}
        </View>

        {receipts.filter((r) => r.withdrawal_status === "SCHEDULED" && r.withdrawal_id).map((r) => (
          <Pressable key={r.id} accessibilityRole="button" disabled={busy} style={s.outlineRow} onPress={() => {
            setBusy(true);
            client.cancelWithdrawal(r.withdrawal_id!).then(() => { setNotice("Scheduled withdrawal canceled."); return load("refresh"); }).catch(() => setNotice("The withdrawal could not be canceled. Refresh to check whether it has already been dispatched.")).finally(() => setBusy(false));
          }}>
            <Text style={s.outlineText}>Cancel scheduled withdrawal · {money(r.amount_minor, r.currency.trim())}</Text>
          </Pressable>
        ))}
        {receipts.some((r) => r.withdrawal_status === "RECONCILING") ? <Text style={s.mutedSmall}>A withdrawal is being checked with the provider; its funds remain held.</Text> : null}

        {notice ? <Text accessibilityRole="alert" style={s.notice}>{notice}</Text> : null}
        {walletDemoAvailable && !demo ? (
          <Pressable accessibilityRole="button" style={s.devLink} onPress={() => setWalletDemo(true)}>
            <Text style={s.mutedSmall}>Developer · View with demo data</Text>
          </Pressable>
        ) : null}

        <View style={s.privacy}>
          <Ionicons name="shield-checkmark-outline" size={20} color={wallet.teal} />
          <Text style={s.privacyText}><Text style={s.privacyTitle}>PrivacyStrip</Text>  Your data is encrypted and never shared.</Text>
        </View>
      </ScrollView>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <SafeAreaView style={s.screen}><StatusBar style="light" />{children}<WalletTabBar active="wallet" /></SafeAreaView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: wallet.bg },
  iconButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 10, gap: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 28 },
  countryRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28 },
  flag: { fontSize: 17 },
  flagBig: { fontSize: 24 },
  countryName: { fontFamily: fonts.semibold, fontSize: 14, color: wallet.text },
  card: { backgroundColor: wallet.card, borderColor: wallet.cardBorder, borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontFamily: fonts.bold, fontSize: 16, color: wallet.text },
  unavailableHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, minHeight: 36, borderRadius: 999, borderWidth: 1, borderColor: wallet.cardBorder, backgroundColor: wallet.raised, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: wallet.teal, borderColor: wallet.teal },
  chipText: { fontFamily: fonts.bold, fontSize: 13, color: wallet.text },
  primary: { flexDirection: "row", gap: 8, backgroundColor: wallet.teal, borderRadius: 12, minHeight: 44, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  primaryText: { fontFamily: fonts.bold, fontSize: 15, color: wallet.onTeal },
  secondary: { alignSelf: "flex-start", borderWidth: 1, borderColor: wallet.teal, borderRadius: 999, minHeight: 36, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.teal },
  disabled: { opacity: 0.5 },
  dim: { opacity: 0.6 },
  balanceCard: { backgroundColor: wallet.card, borderColor: wallet.cardBorder, borderWidth: 1, borderRadius: 14, padding: 12, gap: 2 },
  balanceHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  codePill: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, backgroundColor: wallet.raised },
  codePillText: { fontFamily: fonts.bold, fontSize: 11, color: wallet.teal },
  balance: { fontFamily: fonts.extrabold, fontSize: 30, color: wallet.text, letterSpacing: -0.5 },
  outlineRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: wallet.teal, backgroundColor: "transparent" },
  stealthRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 46, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: wallet.teal, backgroundColor: wallet.tealSoft },
  stealthTitle: { fontFamily: fonts.bold, fontSize: 14, color: wallet.teal },
  twoUp: { flexDirection: "row", gap: 8 },
  half: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: wallet.teal },
  halfWide: { flex: 1.25 },
  halfText: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 13, color: wallet.teal },
  linkSmall: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.teal },
  outlineText: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: wallet.teal },
  quickRow: { flexDirection: "row", gap: 8 },
  quick: { flex: 1, minHeight: 84, alignItems: "center", gap: 4, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 12, backgroundColor: wallet.raised, borderWidth: 1, borderColor: wallet.cardBorder },
  quickIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: wallet.bg, alignItems: "center", justifyContent: "center" },
  lock: { position: "absolute", right: -3, bottom: -3, width: 18, height: 18, borderRadius: 9, backgroundColor: wallet.raised, alignItems: "center", justifyContent: "center" },
  quickText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15, color: wallet.text, textAlign: "center" },
  quickReason: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 12, color: wallet.muted, textAlign: "center" },
  quickChevron: { position: "absolute", right: 6, bottom: 8 },
  emptyBox: { alignItems: "center", gap: 4, paddingVertical: 4 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 17, color: wallet.text, textAlign: "center" },
  emptyTitleSmall: { fontFamily: fonts.semibold, fontSize: 14, color: wallet.text },
  opRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, minHeight: 46 },
  opDivider: { borderTopWidth: 1, borderTopColor: wallet.raised },
  opIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  opTitle: { fontFamily: fonts.semibold, fontSize: 13 },
  opAmountCol: { alignItems: "flex-end", minWidth: 70 },
  opCode: { fontFamily: fonts.medium, fontSize: 10, color: wallet.muted },
  opAmount: { fontFamily: fonts.bold, fontSize: 13 },
  muted: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: wallet.muted },
  mutedSmall: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: wallet.muted },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.teal, paddingVertical: 4 },
  notice: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, color: wallet.text },
  failure: { borderColor: wallet.danger, borderWidth: 1, borderRadius: 10, padding: 10, gap: 2 },
  failureTitle: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: wallet.text },
  privacy: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: wallet.tealSoft, borderColor: wallet.tealDeep, borderWidth: 1, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  devLink: { alignSelf: "center", minHeight: 28, justifyContent: "center" },
  privacyText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: wallet.muted },
  privacyTitle: { fontFamily: fonts.bold, fontSize: 13, color: wallet.teal }
});
