import { useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { wallet, WalletHeader, WalletTabBar } from "../../components/wallet/theme";
import { walletErrorText } from "../../services/wallet-errors";
import { getApiBaseUrl } from "../../config/api";
import { WalletService } from "../../services/wallet.service";
import { accessTokenProvider } from "../../services/session";
import { useAccounts } from "../../account/AccountContext";
import { fonts } from "../../theme/tokens";

/** Provider-hosted bank/debit-card linking. Linking never moves money, and no account number is entered or stored here. */
export default function WalletLinkBank() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { active } = useAccounts();
  const userId = active?.userId;
  const owner = useRef(userId);
  owner.current = userId;
  const client = useMemo(() => new WalletService(getApiBaseUrl(), async () => {
    const token = await accessTokenProvider.getAccessToken();
    if (!userId || owner.current !== userId) throw new Error("Account changed. Reopen bank linking.");
    return token;
  }), [userId]);
  const [session, setSession] = useState<{ id: string; url: string; owner: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function begin(type: "BANK_ACCOUNT" | "DEBIT_CARD") {
    setBusy(true); setMessage("");
    try {
      const r = await client.beginBankLink(type);
      if (owner.current !== userId) return;
      setSession({ ...r, owner: userId! });
      await Linking.openURL(r.url);
    } catch (e) { if (owner.current === userId) setMessage(walletErrorText(e, "Unable to open secure setup.")); } finally { setBusy(false); }
  }

  async function confirm() {
    if (!session || session.owner !== userId) return;
    setBusy(true);
    try {
      await client.confirmBankLink(session.id);
      if (owner.current === userId) { setSession(null); setMessage("Account verified. It is available for the funding or withdrawal options approved by your provider."); }
    } catch (e) { if (owner.current === userId) setMessage(walletErrorText(e, "Verification is not complete.")); } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="light" />
      <WalletHeader title="Link account" onBack={() => (router.canGoBack() ? router.back() : router.replace("/wallet"))} />
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.muted}>Complete verification on the provider's secure page, then return here. Linking an account does not move money.</Text>
        <Pressable accessibilityRole="button" disabled={busy} style={[s.cta, busy && s.disabled]} onPress={() => void begin("BANK_ACCOUNT")}>
          <Text style={s.ctaText}>Link bank account</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={[s.cta, busy && s.disabled]} onPress={() => void begin("DEBIT_CARD")}>
          <Text style={s.ctaText}>Verify debit card for wallet use</Text>
        </Pressable>
        {session && session.owner === userId ? (
          <View style={s.card}>
            <Pressable accessibilityRole="button" disabled={busy} style={[s.cta, busy && s.disabled]} onPress={() => void confirm()}>
              <Text style={s.ctaText}>Check verification</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(session.url)}><Text style={s.link}>Reopen secure setup</Text></Pressable>
          </View>
        ) : null}
        {message || busy ? <Text accessibilityRole="alert" style={s.message}>{busy ? "Please wait…" : message}</Text> : null}
      </ScrollView>
      <WalletTabBar active={from === 'more' ? 'more' : 'wallet'} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: wallet.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontFamily: fonts.bold, fontSize: 22, color: wallet.text },
  content: { padding: 16, gap: 14 },
  muted: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: wallet.muted },
  card: { backgroundColor: wallet.card, borderRadius: 12, padding: 16, gap: 10 },
  cta: { backgroundColor: wallet.teal, borderRadius: 10, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  ctaText: { fontFamily: fonts.bold, fontSize: 15, color: wallet.onTeal },
  disabled: { opacity: 0.5 },
  link: { fontFamily: fonts.semibold, fontSize: 15, color: wallet.teal, paddingVertical: 10 },
  message: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, color: wallet.text }
});
