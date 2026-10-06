import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCountryClient } from "../../components/CountryLinqaUI";
import type { CountryLinqaCatalog, CountryLinqaPreferences } from "../../services/countrylinqa.service";
import { confirmCountryRoute, ACTIVATION_STEPS, activationPayload, activationSummary, defaultChoices, reachOptions, regionOfCountry, stepError, type ActivationChoices, type ActivationStep, type ReachOption } from "../../services/countrylinqa-activation";
import { fonts } from "../../theme/tokens";

const PURPLE = "#5B3FE0";
const TITLES: Record<ActivationStep, string> = { WELCOME: "", COUNTRY: "Your Country", DISCOVERY: "Discovery Reach", DISCOVERABILITY: "Who Can Discover You", CHAT: "Who Can Chat You", READY: "Ready" };
const flag = (code: string) => code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

/**
 * CountryLinqa first-time activation. There is no separate sign-up: this runs once, inside the
 * Linqa account, and saves everything in a single request when the user taps Explore World.
 * Welcome, Confirm Country, Discovery Reach, Discoverability, Chat Access, Ready.
 */
export default function CountryLinqaActivation() {
  const router = useRouter();
  const client = useCountryClient();
  const [prefs, setPrefs] = useState<CountryLinqaPreferences | null>(null);
  const [catalog, setCatalog] = useState<CountryLinqaCatalog>({ countries: [], regions: [] });
  const [choices, setChoices] = useState<ActivationChoices>(defaultChoices());
  const [step, setStep] = useState<ActivationStep>("WELCOME");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoadError(null);
    Promise.all([client.preferences(), client.catalog()]).then(
      ([next, nextCatalog]) => { if (active) { setPrefs(next); setCatalog(nextCatalog); } },
      (cause) => { if (active) setLoadError(cause instanceof Error ? cause.message.replace(/_/g, " ") : "Unable to load Linqa World"); }
    );
    return () => { active = false; };
  }, [client]));

  const country = catalog.countries.find((c) => c.code === prefs?.verifiedCountryCode);
  const region = useMemo(() => regionOfCountry(catalog, prefs?.verifiedCountryCode ?? null), [catalog, prefs?.verifiedCountryCode]);
  const options = reachOptions(country?.name ?? null, region.name);
  const index = ACTIVATION_STEPS.indexOf(step);

  function back() {
    setError(null); setSearch("");
    if (index === 0) router.canGoBack() ? router.back() : router.replace("/countrylinqa/world");
    else setStep(ACTIVATION_STEPS[index - 1]!);
  }
  function next() {
    if (!prefs) return;
    const problem = stepError(step, choices, prefs);
    if (problem) { setError(problem); return; }
    setError(null); setSearch("");
    setStep(ACTIVATION_STEPS[index + 1]!);
  }
  async function finish() {
    if (!prefs || busy) return;
    setBusy(true); setError(null);
    try {
      await client.savePreferences(activationPayload(choices, prefs, region.code));
      router.replace("/countrylinqa/world");
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "PREFERENCE_VERSION_CONFLICT" ? "Your settings changed on another device. Go back to the start and try again." : code.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) || "Unable to finish setup.");
    } finally { setBusy(false); }
  }

  const filtered = catalog.countries.filter((c) => c.code !== prefs?.verifiedCountryCode && `${c.name} ${c.code}`.toLowerCase().includes(search.toLowerCase())).slice(0, 40);
  function picker(selected: string[], set: (next: string[]) => void) {
    const limit = prefs?.selectionLimits.countries ?? 0;
    return (
      <View style={s.picker}>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search countries" placeholderTextColor="#98A2B3" style={s.search} accessibilityLabel="Search countries" />
        {filtered.map((c) => {
          const on = selected.includes(c.code);
          return (
            <Pressable key={c.code} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={s.countryRow}
              onPress={() => { if (!on && selected.length >= limit) { setError(`Your plan allows up to ${limit} countries.`); return; } setError(null); set(on ? selected.filter((x) => x !== c.code) : [...selected, c.code]); }}>
              <Text style={s.countryFlag}>{flag(c.code)}</Text>
              <Text style={s.countryName}>{c.name}</Text>
              <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? PURPLE : "#98A2B3"} />
            </Pressable>
          );
        })}
        <Text style={s.count}>{selected.length} selected</Text>
      </View>
    );
  }

  function radioList<K extends string>(list: Array<ReachOption<K>>, value: K, allowed: (key: K) => boolean, onPick: (key: K) => void, selectedCountries: string[], setCountries: (next: string[]) => void) {
    return (
      <View accessibilityRole="radiogroup">
        {list.map((item) => {
          const on = value === item.key;
          const ok = allowed(item.key);
          return (
            <View key={item.key}>
              <Pressable accessibilityRole="radio" accessibilityState={{ selected: on, disabled: !ok }} accessibilityLabel={`${item.label}. ${item.detail}${ok ? "" : `. Needs ${item.tier === "ELITE" ? "Elite" : "Premium"}`}`}
                style={[s.option, on && s.optionOn, !ok && { opacity: 0.55 }]}
                onPress={() => { if (!ok) { setError(`${item.label} needs ${item.tier === "ELITE" ? "Elite" : "Premium"}. You can change this later in settings.`); return; } setError(null); setSearch(""); onPick(item.key); }}>
                <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? PURPLE : "#98A2B3"} />
                <View style={{ flex: 1 }}>
                  <Text style={s.optionTitle}>{item.label}</Text>
                  {item.detail ? <Text style={s.optionDetail}>{item.detail}</Text> : null}
                </View>
                {!ok ? <Text style={s.tier}>{item.tier === "ELITE" ? "ELITE" : "PREMIUM"}</Text> : null}
              </Pressable>
              {on && item.key === "SELECTED_COUNTRIES" ? picker(selectedCountries, setCountries) : null}
            </View>
          );
        })}
      </View>
    );
  }

  const primary = (label: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} style={[s.primary, disabled && { opacity: 0.5 }]} onPress={onPress}>
      <Text style={s.primaryText}>{label}</Text>
    </Pressable>
  );

  let body: ReactNode;
  if (!prefs) {
    body = <View style={s.center}>{loadError ? <><Text style={s.error}>{loadError}</Text>{primary("Try again", () => router.replace("/countrylinqa/activate"))}</> : <ActivityIndicator color={PURPLE} />}</View>;
  } else if (step === "WELCOME") {
    body = (
      <>
        <View style={s.hero}>
          <Text style={s.landmarks} accessibilityElementsHidden importantForAccessibility="no">🗽 🗼 🏛️ 🕌 🏰</Text>
          <View style={s.globe}><Ionicons name="earth" size={112} color="#2F7BEA" /></View>
        </View>
        <Text style={s.brand}>Linqa World</Text>
        <Text style={s.tagline}>Connect Locally, Connect Globally.</Text>
        <Text style={s.copy}>Discover people, communities, events and businesses across countries while staying in control of who can find and contact you.</Text>
        <View style={s.spacer} />
        {primary("Continue", next)}
      </>
    );
  } else if (step === "COUNTRY") {
    const verified = prefs.verificationState === "VERIFIED" && !!prefs.verifiedCountryCode;
    body = (
      <>
        <View style={s.flagCard}><Text style={s.bigFlag}>{prefs.verifiedCountryCode ? flag(prefs.verifiedCountryCode) : "🌐"}</Text></View>
        <Text style={s.countryTitle}>{country?.name ?? prefs.verifiedCountryCode ?? "Country not confirmed"}</Text>
        <Text style={s.detected}>({verified ? "Detected & Verified" : "Not verified yet"})</Text>
        <Text style={s.copy}>You can change your country if needed.</Text>
        <View style={s.spacer} />
        {primary("Continue", next, !verified)}
        <Pressable accessibilityRole="button" style={s.secondary} onPress={() => router.push(confirmCountryRoute("/countrylinqa/activate"))}><Text style={s.secondaryText}>{verified ? "Change Country" : "Confirm Country"}</Text></Pressable>
      </>
    );
  } else if (step === "DISCOVERY") {
    body = (
      <>
        <Text style={s.question}>Where would you like to explore?</Text>
        {radioList(options.discovery, choices.discovery, (k) => prefs.allowedModes[k], (k) => setChoices({ ...choices, discovery: k }), choices.discoveryCountries, (n) => setChoices({ ...choices, discoveryCountries: n }))}
        <View style={s.spacer} />{primary("Continue", next)}
      </>
    );
  } else if (step === "DISCOVERABILITY") {
    body = (
      <>
        <Text style={s.question}>Who can discover you?</Text>
        {radioList(options.discoverability, choices.discoverability, (k) => k === "CONTACTS_ONLY" || prefs.allowedModes[k], (k) => setChoices({ ...choices, discoverability: k }), choices.discoverabilityCountries, (n) => setChoices({ ...choices, discoverabilityCountries: n }))}
        <View style={s.spacer} />{primary("Continue", next)}
      </>
    );
  } else if (step === "CHAT") {
    body = (
      <>
        <Text style={s.question}>Who can start a new chat with you?</Text>
        {radioList(options.chat, choices.chat, (k) => prefs.allowedChatModes[k], (k) => setChoices({ ...choices, chat: k }), choices.chatCountries, (n) => setChoices({ ...choices, chatCountries: n }))}
        <Text style={s.note}>Existing conversations aren't affected by this setting.</Text>
        <View style={s.spacer} />{primary("Continue", next)}
      </>
    );
  } else {
    body = (
      <>
        <View style={s.hero}><View style={s.globe}><Ionicons name="earth" size={104} color="#2F7BEA" /></View></View>
        <Text style={s.readyTitle}>Linqa World is ready!</Text>
        <Text style={s.copy}>Explore the world while controlling who can discover and contact you.</Text>
        <View style={s.summary}>
          {activationSummary(choices).map((row) => (
            <View key={row.label} style={s.summaryRow}><Text style={s.summaryLabel}>{row.label}</Text><Text style={s.summaryValue}>{row.value}</Text></View>
          ))}
        </View>
        <View style={s.spacer} />
        {primary(busy ? "Saving…" : "Explore World", () => void finish(), busy)}
      </>
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.headerButton} onPress={back}><Ionicons name="chevron-back" size={26} color="#101828" /></Pressable>
        <Text accessibilityRole="header" style={s.title}>{TITLES[step]}</Text>
        <View style={s.headerButton} />
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {body}
        {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: 6, minHeight: 52 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: PURPLE, fontFamily: fonts.semibold, fontSize: 18 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 28 },
  center: { alignItems: "center", paddingTop: 80, gap: 14 },
  hero: { alignItems: "center", justifyContent: "center", minHeight: 230, borderRadius: 22, backgroundColor: "#EAF3FF", marginBottom: 18 },
  landmarks: { fontSize: 30, letterSpacing: 6, marginBottom: 8 },
  globe: { width: 140, height: 140, borderRadius: 70, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#2F7BEA", shadowOpacity: 0.3, shadowRadius: 18, elevation: 6 },
  brand: { color: PURPLE, fontFamily: fonts.extrabold, fontSize: 30, textAlign: "center" },
  tagline: { color: PURPLE, fontFamily: fonts.medium, fontSize: 15, textAlign: "center", marginTop: 6 },
  copy: { color: "#475467", fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, textAlign: "center", marginTop: 14 },
  spacer: { flex: 1, minHeight: 24 },
  primary: { height: 54, borderRadius: 14, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 17 },
  secondary: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 10, backgroundColor: "#F4F1FF" },
  secondaryText: { color: PURPLE, fontFamily: fonts.semibold, fontSize: 16 },
  flagCard: { alignSelf: "center", width: 240, height: 150, borderRadius: 14, backgroundColor: "#F5F6FB", alignItems: "center", justifyContent: "center", marginTop: 14, borderWidth: 1, borderColor: "#E7E9F2" },
  bigFlag: { fontSize: 84 },
  countryTitle: { color: PURPLE, fontFamily: fonts.extrabold, fontSize: 24, textAlign: "center", marginTop: 20 },
  detected: { color: "#667085", fontFamily: fonts.regular, fontSize: 14, textAlign: "center", marginTop: 4 },
  question: { color: "#344054", fontFamily: fonts.medium, fontSize: 16, textAlign: "center", marginBottom: 18 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: "transparent", marginBottom: 4 },
  optionOn: { backgroundColor: "#F1EEFF", borderColor: "#D9D2FF" },
  optionTitle: { color: "#101828", fontFamily: fonts.semibold, fontSize: 16 },
  optionDetail: { color: "#667085", fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  tier: { color: "#B54708", fontFamily: fonts.bold, fontSize: 11 },
  note: { color: "#667085", fontFamily: fonts.regular, fontSize: 13, textAlign: "center", marginTop: 16 },
  picker: { marginLeft: 8, marginBottom: 10, borderLeftWidth: 2, borderLeftColor: "#E4E0FF", paddingLeft: 12 },
  search: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: "#E7E9F2", paddingHorizontal: 12, fontFamily: fonts.regular, fontSize: 15, color: "#101828", marginVertical: 8 },
  countryRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 46 },
  countryFlag: { fontSize: 22 },
  countryName: { flex: 1, color: "#101828", fontFamily: fonts.regular, fontSize: 15 },
  count: { color: "#667085", fontFamily: fonts.medium, fontSize: 13, marginTop: 6 },
  readyTitle: { color: "#101828", fontFamily: fonts.extrabold, fontSize: 22, textAlign: "center" },
  summary: { marginTop: 22, borderRadius: 14, borderWidth: 1, borderColor: "#E4E0FF", padding: 16, gap: 12 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { color: PURPLE, fontFamily: fonts.semibold, fontSize: 15 },
  summaryValue: { color: "#475467", fontFamily: fonts.medium, fontSize: 15 },
  error: { color: "#B42318", fontFamily: fonts.medium, fontSize: 14, textAlign: "center", marginTop: 14 }
});
