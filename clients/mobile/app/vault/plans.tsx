import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Badge, Card, Loading, Notice, ProgressBar, VaultHeader, VaultScreen, vault } from "../../components/vault/ui";
import { getApiBaseUrl } from "../../config/api";
import { accessTokenProvider } from "../../services/session";
import { VaultService, type VaultPlans } from "../../services/vault.service";
import { failureText, formatBytes, planPrice, planSize } from "../../services/vault-view";
import { fonts } from "../../theme/tokens";

/**
 * Storage Plans: sizes and prices as stored on the server, and the user's current plan and usage.
 * Choosing a different plan needs a billing provider, which is not connected, so plans are shown
 * but cannot be switched yet.
 */
export default function VaultPlansScreen() {
  const client = useMemo(() => new VaultService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()), []);
  const [data, setData] = useState<VaultPlans | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Where the payment page sends the user back to. Without it, checkout is not offered.
  const returnBase = process.env.EXPO_PUBLIC_VAULT_RETURN_BASE_URL;

  async function upgrade() {
    if (!data) return;
    if (!picked || picked === data.current.planCode) { setNote("Pick a different plan first."); return; }
    if (!data.billingAvailable || !returnBase) { setNote(failureText("BILLING_NOT_CONFIGURED")); return; }
    setBusy(true);
    setNote(null);
    try {
      const checkout = await client.checkout(picked, { successUrl: `${returnBase}/vault/billing/success`, cancelUrl: `${returnBase}/vault/billing/cancel` }, `${picked}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
      await Linking.openURL(checkout.checkoutUrl);
    } catch (cause) {
      setNote(failureText(cause instanceof Error ? cause.message : ""));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    client.plans().then(
      (result) => { if (active) setData(result); },
      (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to load plans"); }
    );
    return () => { active = false; };
  }, [client]);

  const current = data?.current;
  const share = current && current.quotaBytes > 0 ? ((current.usedBytes + current.reservedBytes) / current.quotaBytes) * 100 : 0;
  const currentPlan = data?.plans.find((p) => p.code === current?.planCode);

  return (
    <VaultScreen tab="more">
      <VaultHeader title="Storage Plans" subtitle="Choose the plan that fits you" back />
      <ScrollView contentContainerStyle={s.content}>
        {error ? <Notice tone="warn" text={error} /> : null}
        {!data && !error ? <Loading /> : null}

        {data && current ? (
          <>
            <Card style={s.currentCard}>
              <View style={s.crown}><Ionicons name="shield-checkmark" size={26} color={vault.amber} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.small}>Current Plan</Text>
                <Text style={s.big}>{planSize(current.quotaBytes)} Plan</Text>
                <Text style={s.small}>{formatBytes(current.usedBytes)} / {planSize(current.quotaBytes)} used</Text>
                <View style={{ marginTop: 10 }}><ProgressBar value={Math.max(share, current.usedBytes > 0 ? 1 : 0)} /></View>
              </View>
            </Card>

            <Card style={{ marginTop: 16, paddingHorizontal: 14 }}>
              {data.plans.map((plan, index) => {
                const on = plan.code === current.planCode;
                const chosen = picked === plan.code;
                return (
                  <Pressable key={plan.code} accessibilityRole="radio" accessibilityState={{ selected: chosen || (on && !picked) }} accessibilityLabel={`${planSize(plan.quotaBytes)}, ${planPrice(plan.monthlyPriceMinor, plan.currency)}${on ? ", current plan" : ""}`} style={[s.row, index > 0 && s.border]} onPress={() => setPicked(plan.code)}>
                    <View style={[s.radio, (on || chosen) && s.radioOn]}>{on || chosen ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : null}</View>
                    <Text style={s.size}>{planSize(plan.quotaBytes)}</Text>
                    {on ? <Text style={s.currentTag}>Current</Text> : null}
                    <Text style={s.price}>{planPrice(plan.monthlyPriceMinor, plan.currency)}</Text>
                  </Pressable>
                );
              })}
            </Card>

            {note ? <View style={{ marginTop: 14 }}><Notice tone="warn" text={note} /></View> : null}
            <View style={s.actions}>
              <Text accessibilityRole="button" accessibilityState={{ disabled: busy }} style={s.link} onPress={() => void upgrade()}>{busy ? "Opening…" : "Upgrade"}</Text>
              <Badge text={data.billingAvailable ? "Billing ready" : "Billing not connected"} tone={data.billingAvailable ? "ok" : "off"} />
            </View>
            {currentPlan ? <Text style={s.fine}>Usage counts files saved from Linqa Social. Prices are per month.</Text> : null}
          </>
        ) : null}
      </ScrollView>
    </VaultScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  currentCard: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  crown: { width: 52, height: 64, borderRadius: 10, borderWidth: 1, borderColor: vault.border, backgroundColor: "#0A1827", alignItems: "center", justifyContent: "center" },
  small: { color: vault.muted, fontFamily: fonts.regular, fontSize: 12 },
  big: { color: vault.text, fontFamily: fonts.semibold, fontSize: 19, marginVertical: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56 },
  border: { borderTopWidth: 1, borderTopColor: vault.border },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: vault.faint, alignItems: "center", justifyContent: "center" },
  radioOn: { backgroundColor: vault.blue, borderColor: vault.blue },
  size: { color: vault.text, fontFamily: fonts.medium, fontSize: 15 },
  currentTag: { color: vault.blueText, backgroundColor: "#12306A", fontFamily: fonts.semibold, fontSize: 11, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: "hidden" },
  price: { flex: 1, textAlign: "right", color: vault.text, fontFamily: fonts.medium, fontSize: 14 },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, minHeight: 44 },
  link: { color: vault.blueText, fontFamily: fonts.semibold, fontSize: 15, paddingVertical: 10 },
  fine: { color: vault.faint, fontFamily: fonts.regular, fontSize: 12, marginTop: 8 }
});
