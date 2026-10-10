import { useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinqaSendStatusBar, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { METHOD_LABEL, SEND_COUNTRIES, findCountry, normalizePhone } from "../../services/linqasend-countries";
import { LinqaSendApiError, LinqaSendService } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { fonts } from "../../theme/tokens";

const API = getApiBaseUrl();
type Kind = "EXTERNAL_PERSON" | "EXTERNAL_BUSINESS";
type Method = "MOBILE_MONEY" | "BANK";

const flagOf = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));

const ERRORS: Record<string, string> = {
  certified_payout_provider_required: "Sending to this destination isn't available yet. No payout partner is connected.",
  provider_token_kms_not_configured: "Recipient storage isn't set up on this server yet.",
  validation_error: "Check the details and try again."
};

function Picker<T extends string>({ label, value, placeholder, options, onChange, leading }: {
  label: string; value: T | null; placeholder: string; options: Array<{ value: T; label: string; leading?: string }>; onChange: (value: T) => void; leading?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <>
      <Text style={s.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`} style={s.field} onPress={() => setOpen(true)}>
        {selected?.leading || leading ? <Text style={s.fieldFlag}>{selected?.leading ?? leading}</Text> : null}
        <Text style={[s.fieldText, !selected && { color: send.faint }]}>{selected?.label ?? placeholder}</Text>
        <Ionicons name="chevron-down" size={20} color={send.text} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)} accessibilityLabel={`Close ${label}`} />
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>{label}</Text>
          <ScrollView>
            {options.map((option) => (
              <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: option.value === value }} style={s.option} onPress={() => { onChange(option.value); setOpen(false); }}>
                <Text style={s.optionText}>{option.leading ? `${option.leading}  ` : ""}{option.label}</Text>
                {option.value === value ? <Ionicons name="checkmark" size={22} color={send.primary} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

export default function LinqaSendAddRecipient() {
  const router = useRouter();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [kind, setKind] = useState<Kind>("EXTERNAL_PERSON");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [account, setAccount] = useState("");
  const [favorite, setFavorite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const country = findCountry(countryCode);
  const methods = country?.methods ?? [];
  const chosenMethod: Method | null = method && methods.includes(method) ? method : methods[0] ?? null;
  const saveAs = name.trim() ? `${name.trim()}${country ? ` (${country.name})` : ""}` : "";

  function pickCountry(code: string) {
    setCountryCode(code);
    setMethod(null); // the new country's own default
    setError(null);
  }

  async function save() {
    setError(null);
    if (name.trim().length < 2) return setError(kind === "EXTERNAL_BUSINESS" ? "Enter the business name." : "Enter the recipient's full name.");
    if (!country || !chosenMethod) return setError("Choose a country and how they receive money.");
    const e164 = normalizePhone(phone, country.dial);
    if (chosenMethod === "MOBILE_MONEY" && !e164) return setError(`Enter a valid ${country.name} mobile number.`);
    if (phone.trim() && !e164) return setError(`Enter a valid ${country.name} phone number, or leave it blank.`);
    const accountDigits = account.replace(/\s/g, "");
    if (chosenMethod === "BANK" && !/^[A-Za-z0-9]{8,34}$/.test(accountDigits)) return setError("Enter the bank account number (8 to 34 letters or digits).");

    const secret = chosenMethod === "MOBILE_MONEY" ? e164! : accountDigits;
    setBusy(true);
    try {
      // The server decides which payout partners are acceptable; the client only passes one it listed.
      const providers = (await client.payoutProviders()).items;
      if (providers.length === 0) return setError(ERRORS.certified_payout_provider_required!);
      const result = await client.addExternalRecipient({
        recipientKind: kind,
        displayName: name.trim(),
        countryCode: country.code,
        currency: country.currency,
        deliveryMethod: chosenMethod,
        provider: providers[0]!.providerId,
        providerToken: secret,
        maskedDisplay: `${METHOD_LABEL[chosenMethod]} •••• ${secret.slice(-4)}`,
        ...(e164 ? { phone: e164 } : {}),
        favorite
      });
      router.replace({
        pathname: "/linqasend/amount",
        params: { recipientId: result.recipientId, recipientName: name.trim(), recipientCountry: country.code, recipientCurrency: country.currency, recipientType: chosenMethod === "MOBILE_MONEY" ? "MOBILE_WALLET" : "BANK" }
      });
    } catch (cause) {
      const code = cause instanceof LinqaSendApiError && typeof cause.payload.error === "string" ? cause.payload.error : cause instanceof Error ? cause.message : "";
      setError(ERRORS[code] ?? (code ? code.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to save this recipient."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.headerButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={send.text} />
        </Pressable>
        <Text accessibilityRole="header" style={s.title}>Add Recipient</Text>
        <View style={s.headerButton} />
      </View>

      <View style={s.tabs} accessibilityRole="tablist">
        {([["EXTERNAL_PERSON", "Individual"], ["EXTERNAL_BUSINESS", "Business"]] as const).map(([key, label]) => (
          <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: kind === key }} style={[s.tab, kind === key && s.tabActive]} onPress={() => setKind(key)}>
            <Text style={[s.tabText, kind === key && s.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          <Text style={s.label}>{kind === "EXTERNAL_BUSINESS" ? "Business Name" : "Full Name"}</Text>
          <TextInput accessibilityLabel="Full name" value={name} onChangeText={setName} placeholder={kind === "EXTERNAL_BUSINESS" ? "Business name" : "Full name"} placeholderTextColor={send.faint} autoCapitalize="words" style={s.input} />

          <Text style={s.label}>Phone Number</Text>
          <TextInput accessibilityLabel="Phone number" value={phone} onChangeText={setPhone} placeholder={country ? `+${country.dial} …` : "+233 24 123 4567"} placeholderTextColor={send.faint} keyboardType="phone-pad" style={s.input} />

          <Picker
            label="Country"
            value={countryCode}
            placeholder="Select country"
            options={SEND_COUNTRIES.map((c) => ({ value: c.code, label: c.name, leading: flagOf(c.code) }))}
            onChange={pickCountry}
          />

          <Picker
            label="Preferred Method"
            value={chosenMethod}
            placeholder={country ? "Select method" : "Choose a country first"}
            options={methods.map((m) => ({ value: m, label: METHOD_LABEL[m] }))}
            onChange={setMethod}
          />

          {chosenMethod === "BANK" ? (
            <>
              <Text style={s.label}>Account Number</Text>
              <TextInput accessibilityLabel="Bank account number" value={account} onChangeText={setAccount} placeholder="Account number or IBAN" placeholderTextColor={send.faint} autoCapitalize="characters" autoCorrect={false} style={s.input} />
              <Text style={s.help}>Stored encrypted. Only the last 4 characters are ever shown.</Text>
            </>
          ) : null}

          <Text style={s.label}>Save as</Text>
          <View style={s.saveRow}>
            <Text style={s.saveText} numberOfLines={1}>{saveAs || "Their name (country)"}</Text>
            <Switch accessibilityLabel="Mark as a favorite contact" value={favorite} onValueChange={setFavorite} trackColor={{ true: send.primary, false: send.border }} thumbColor="#FFFFFF" />
          </View>

          {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={s.footer}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={[s.save, busy && { opacity: 0.6 }]} onPress={save}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.saveButtonText}>Save Recipient</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: send.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: send.text, fontFamily: fonts.extrabold, fontSize: 18 },
  tabs: { flexDirection: "row", marginTop: 6, borderBottomWidth: 1, borderBottomColor: send.border },
  tab: { flex: 1, alignItems: "center", paddingVertical: 14, borderBottomWidth: 2.5, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: send.primary },
  tabText: { color: send.text, fontFamily: fonts.semibold, fontSize: 15 },
  tabTextActive: { color: send.primary, fontFamily: fonts.bold },
  form: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  label: { color: send.text, fontFamily: fonts.semibold, fontSize: 14, marginTop: 20, marginBottom: 9 },
  input: { height: 56, borderRadius: 14, borderWidth: 1.5, borderColor: send.border, paddingHorizontal: 16, color: send.text, fontFamily: fonts.medium, fontSize: 16, backgroundColor: send.bg },
  field: { flexDirection: "row", alignItems: "center", gap: 12, height: 56, borderRadius: 14, borderWidth: 1.5, borderColor: send.border, paddingHorizontal: 16, backgroundColor: send.bg },
  fieldFlag: { fontSize: 24 },
  fieldText: { flex: 1, color: send.text, fontFamily: fonts.semibold, fontSize: 16 },
  help: { color: send.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 8 },
  saveRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, gap: 12 },
  saveText: { flex: 1, color: send.text, fontFamily: fonts.semibold, fontSize: 16 },
  error: { color: send.danger, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, marginTop: 18 },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, backgroundColor: send.bg },
  save: { height: 56, borderRadius: 16, backgroundColor: send.primary, alignItems: "center", justifyContent: "center" },
  saveButtonText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 17 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { maxHeight: "65%", backgroundColor: send.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24 },
  sheetTitle: { color: send.text, fontFamily: fonts.extrabold, fontSize: 18, marginBottom: 8 },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52, borderBottomWidth: 1, borderBottomColor: send.border },
  optionText: { color: send.text, fontFamily: fonts.semibold, fontSize: 16 }
});
