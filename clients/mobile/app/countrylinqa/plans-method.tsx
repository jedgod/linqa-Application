import { useCallback, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Empty, Spinner, WorldHeader, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import { METHODS, methodAvailability, safeReturn, type PaymentMethod, type PlansResponse } from "../../services/countrylinqa-plans";
import { fonts } from "../../theme/tokens";

/** 6.2 Payment Method. Methods the provider or this phone can not use are shown, switched off, with the reason. */
export default function CountryLinqaPaymentMethod() {
  const router = useRouter();
  const client = useCountryClient();
  const { plan, from } = useLocalSearchParams<{ plan?: string; from?: string }>();
  const [data, setData] = useState<PlansResponse | null>(null);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    client.plans().then((p) => { if (active) setData(p); }, (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load payment methods"); });
    return () => { active = false; };
  }, [client, reload]));

  const ok = method && data ? methodAvailability(method, Platform.OS, data.methods).available : false;
  return (
    <WorldScreen>
      <WorldHeader title="Payment Method" back />
      <ScrollView contentContainerStyle={s.content}>
        {error ? <Empty icon="cloud-offline-outline" title="Can not load payment methods" text={error} action={{ label: "Try again", onPress: () => setReload((n) => n + 1) }} /> : null}
        {!data && !error ? <Spinner /> : null}
        {data ? (
          <View accessibilityRole="radiogroup">
            {METHODS.map((m) => {
              const a = methodAvailability(m.key, Platform.OS, data.methods);
              const on = method === m.key && a.available;
              return (
                <Pressable key={m.key} accessibilityRole="radio" accessibilityState={{ selected: on, disabled: !a.available }} accessibilityLabel={`${m.label}${a.reason ? `. ${a.reason}` : ""}`}
                  style={[s.row, on && s.rowOn, !a.available && { opacity: 0.55 }]} onPress={() => { if (a.available) setMethod(m.key); }}>
                  <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? world.purple : "#98A2B3"} />
                  <Ionicons name={m.icon} size={22} color={world.text} />
                  <View style={{ flex: 1 }}><Text style={s.label}>{m.label}</Text>{a.reason ? <Text style={s.reason}>{a.reason}</Text> : null}</View>
                </Pressable>
              );
            })}
            {!data.paymentsAvailable ? <Text style={s.note}>No payment provider is connected yet, so nothing can be paid right now. You will not be charged.</Text> : null}
          </View>
        ) : null}
      </ScrollView>
      <View style={s.footer}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ok }} disabled={!ok} style={[s.primary, !ok && { opacity: 0.45 }]}
          onPress={() => router.push({ pathname: "/countrylinqa/plans-confirm", params: { plan: plan ?? "", method: method ?? "", from: safeReturn(from) } })}>
          <Text style={s.primaryText}>Continue</Text>
        </Pressable>
      </View>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderRadius: 14, paddingHorizontal: 14, marginBottom: 10, borderWidth: 1.5, borderColor: world.border },
  rowOn: { borderColor: world.purple, backgroundColor: "#F8F6FF" },
  label: { color: world.text, fontFamily: fonts.semibold, fontSize: 16 },
  reason: { color: world.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  note: { color: "#7A4B00", backgroundColor: "#FFF6E5", borderRadius: 12, padding: 14, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, marginTop: 4 },
  footer: { paddingHorizontal: 20, paddingBottom: 14, paddingTop: 8 },
  primary: { height: 54, borderRadius: 14, backgroundColor: world.purple, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 17 }
});
