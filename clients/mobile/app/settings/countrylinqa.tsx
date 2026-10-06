import { Ionicons } from "@expo/vector-icons";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  type CountryLinqaCatalog, type CountryLinqaPreferences,
  type DiscoveryMode, type InboundReach
} from "../../services/countrylinqa.service";
import { useCountryClient } from "../../components/CountryLinqaUI";
const purple = "#6045E8";
type Screen = "SETTINGS" | "OUTBOUND_COUNTRIES" | "OUTBOUND_REGIONS" | "INBOUND_COUNTRIES" | "INBOUND_REGIONS" | "WORLDWIDE" | "PLANS" | "SUCCESS";
type Draft = Pick<CountryLinqaPreferences,
  "mode" | "selectedCountries" | "selectedRegions" | "inboundReach" | "inboundSelectedCountries" |
  "inboundSelectedRegions" | "showCity" | "showState" | "showCountry" | "verifiedOnly" |
  "allowBusinesses" | "allowCommunities" | "allowEvents" | "paused">;

const outboundModes: Array<{ key: DiscoveryMode; label: string; detail: string; tier: "FREE" | "PREMIUM" | "ELITE" }> = [
  { key: "MY_COUNTRY", label: "My Country", detail: "Discover people in your verified country.", tier: "FREE" },
  { key: "SELECTED_COUNTRIES", label: "Selected Countries", detail: "Choose the countries you want to explore.", tier: "PREMIUM" },
  { key: "REGION", label: "My Region", detail: "Discover within selected geographic regions.", tier: "PREMIUM" },
  { key: "GLOBAL", label: "Worldwide", detail: "Connect with people from around the world.", tier: "ELITE" }
];
const inboundModes: Array<{ key: InboundReach; label: string; detail: string; tier: "FREE" | "PREMIUM" | "ELITE" }> = [
  { key: "MY_COUNTRY", label: "My Country Only", detail: "Only people in your verified country can find you.", tier: "FREE" },
  { key: "SELECTED_COUNTRIES", label: "Selected Countries", detail: "Only people in countries you select can find you.", tier: "PREMIUM" },
  { key: "REGION", label: "My Region", detail: "People in selected regions can find you.", tier: "PREMIUM" },
  { key: "GLOBAL", label: "Worldwide", detail: "People worldwide can discover you.", tier: "ELITE" },
  { key: "CONTACTS_ONLY", label: "Existing Contacts Only", detail: "Block new geographic discovery while keeping contacts.", tier: "FREE" }
];

function titleFor(value: DiscoveryMode | InboundReach) {
  return [...outboundModes, ...inboundModes].find((item) => item.key === value)?.label ?? value;
}

export default function CountryLinqaSettings() {
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string }>();
  const api = useCountryClient();
  const [prefs, setPrefs] = useState<CountryLinqaPreferences | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [catalog, setCatalog] = useState<CountryLinqaCatalog>({ countries: [], regions: [] });
  const [screen, setScreen] = useState<Screen>(params.view === "PLANS" ? "PLANS" : "SETTINGS");
  const [pickerSelection, setPickerSelection] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<"FREE" | "PREMIUM" | "ELITE">("PREMIUM");
  const [worldwideInbound, setWorldwideInbound] = useState(false);
  const lifecycle = useRef(0);

  async function load() {
    const generation = lifecycle.current;
    setError(null);
    const [next, nextCatalog] = await Promise.all([api.preferences(), api.catalog()]);
    if (generation !== lifecycle.current) return null;
    setPrefs(next); setDraft(next); setCatalog(nextCatalog);
    return next;
  }
  useFocusEffect(useCallback(() => {
    let current = true;
    lifecycle.current++;
    setPrefs(null); setDraft(null); setError(null); setBusy(false);
    setPickerSelection([]); setSearch(""); setSelectedPlan("PREMIUM"); setWorldwideInbound(false);
    setScreen(params.view === "PLANS" ? "PLANS" : "SETTINGS");
    Promise.all([api.preferences(), api.catalog()]).then(([next, nextCatalog]) => {
      if (current) { setPrefs(next); setDraft(next); setCatalog(nextCatalog); }
    }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : "Unable to load Discovery Settings"); });
    return () => { current = false; lifecycle.current++; };
  }, [api, params.view]));

  function allowed(mode: DiscoveryMode) { return prefs?.allowedModes[mode] ?? false; }
  function selectOutbound(mode: DiscoveryMode) {
    setError(null); setSearch("");
    if (mode === "SELECTED_COUNTRIES") { setPickerSelection(draft?.selectedCountries ?? []); setScreen("OUTBOUND_COUNTRIES"); }
    else if (mode === "REGION") { setPickerSelection(draft?.selectedRegions ?? []); setScreen("OUTBOUND_REGIONS"); }
    else if (mode === "GLOBAL") { setWorldwideInbound(false); setScreen("WORLDWIDE"); }
    else setDraft((value) => value && ({ ...value, mode }));
  }
  function selectInbound(mode: InboundReach) {
    setError(null); setSearch("");
    if (mode === "SELECTED_COUNTRIES") { setPickerSelection(draft?.inboundSelectedCountries ?? []); setScreen("INBOUND_COUNTRIES"); }
    else if (mode === "REGION") { setPickerSelection(draft?.inboundSelectedRegions ?? []); setScreen("INBOUND_REGIONS"); }
    else if (mode === "GLOBAL") { setWorldwideInbound(true); setScreen("WORLDWIDE"); }
    else setDraft((value) => value && ({ ...value, inboundReach: mode }));
  }

  async function save(value = draft) {
    if (!value) return false;
    const generation = lifecycle.current;
    setBusy(true); setError(null);
    try {
      const next = await api.savePreferences({
        ...value,
        selectedCountries: value.mode === "SELECTED_COUNTRIES" ? value.selectedCountries : [],
        selectedRegions: value.mode === "REGION" ? value.selectedRegions : [],
        inboundSelectedCountries: value.inboundReach === "SELECTED_COUNTRIES" ? value.inboundSelectedCountries : [],
        inboundSelectedRegions: value.inboundReach === "REGION" ? value.inboundSelectedRegions : [],
        locationPrecision: value.showCity ? "CITY" : value.showState ? "STATE" : "COUNTRY",
        expectedVersion: prefs?.version
      });
      if (generation !== lifecycle.current) return false;
      setPrefs(next); setDraft(next);
      return true;
    } catch (cause) {
      if (generation === lifecycle.current) {
        const message = cause instanceof Error ? cause.message : "Unable to save Discovery Settings";
        if (message === "PREFERENCE_VERSION_CONFLICT") {
          // Changed on another device: show the current settings instead of overwriting them.
          try { const fresh = await api.preferences(); if (generation === lifecycle.current) { setPrefs(fresh); setDraft(fresh); } } catch { /* keep the error below */ }
          setError("Your Discovery Settings changed on another device. We loaded the latest, so review and save again.");
        } else setError(message);
      }
      return false;
    }
    finally { if (generation === lifecycle.current) setBusy(false); }
  }

  if (!draft || !prefs) return <SafeAreaView style={s.screen}><Header title="Discovery Settings" back={() => router.back()} /><View style={s.loading}>{error ? <Text style={s.error}>{error}</Text> : <ActivityIndicator color={purple} />}</View></SafeAreaView>;

  if (screen.includes("COUNTRIES")) {
    const inbound = screen === "INBOUND_COUNTRIES";
    const selected = pickerSelection;
    const limit = prefs.selectionLimits.countries;
    const unlocked = allowed("SELECTED_COUNTRIES");
    const rows = catalog.countries.filter((country) => `${country.name} ${country.code}`.toLowerCase().includes(search.toLowerCase()));
    return <Page busy={busy} title="Select Countries" back={() => { setSearch(""); setScreen("SETTINGS"); }}>
      <Text style={s.centerCopy}>Choose countries for {inbound ? "inbound" : "outbound"} discovery.{unlocked ? ` Your plan allows up to ${limit}.` : " Premium or Elite access is required."}</Text>
      {!unlocked && <View style={s.upgradeNotice}><Text style={s.badge}>PREMIUM</Text><Pressable onPress={() => setScreen("PLANS")} accessibilityRole="button"><Text style={s.link}>View plans</Text></Pressable></View>}
      <View style={s.search}><Ionicons name="search" size={18} color="#667085" /><TextInput style={s.searchInput} accessibilityLabel="Search countries" value={search} onChangeText={setSearch} placeholder="Search countries" /></View>
      {rows.map((country) => { const on = selected.includes(country.code); return <Pressable key={country.code} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !unlocked }} accessibilityLabel={country.name} disabled={!unlocked} style={[s.listRow, on && s.selected, !unlocked && s.disabled]} onPress={() => {
        if (!on && selected.length >= limit) { setError(`Your plan allows up to ${limit} countries.`); return; }
        const next = on ? selected.filter((code) => code !== country.code) : [...selected, country.code];
        setPickerSelection(next); setError(null);
      }}><Text style={s.flag}>{flag(country.code)}</Text><View style={s.flex}><Text style={s.rowTitle}>{country.name}</Text><Text style={s.rowCopy}>{country.callingCode ?? country.code}</Text></View><Ionicons name={on ? "checkbox" : "square-outline"} size={23} color={on ? purple : "#98A2B3"} /></Pressable>; })}
      {!rows.length && <Text style={s.centerCopy}>No countries match your search.</Text>}
      <Text style={s.count}>{selected.length} countries selected</Text><InlineError value={error} /><Primary label={busy ? "Saving…" : "Save Selection"} onPress={async () => { if (await save({ ...draft, ...(inbound ? { inboundReach: "SELECTED_COUNTRIES", inboundSelectedCountries: selected } : { mode: "SELECTED_COUNTRIES", selectedCountries: selected }) })) { setSearch(""); setScreen("SETTINGS"); } }} disabled={busy || !unlocked || selected.length === 0 || selected.length > limit} />
    </Page>;
  }

  if (screen.includes("REGIONS")) {
    const inbound = screen === "INBOUND_REGIONS";
    const selected = pickerSelection;
    const unlocked = allowed("REGION");
    const rows = catalog.regions.filter(region => `${region.name} ${region.code}`.toLowerCase().includes(search.toLowerCase()));
    return <Page busy={busy} title="Select Region" back={() => setScreen("SETTINGS")}>
      <Text style={s.centerCopy}>Choose regions for {inbound ? "inbound" : "outbound"} discovery.{unlocked ? ` Your plan allows up to ${prefs.selectionLimits.regions}.` : " Premium or Elite access is required."}</Text>
      {!unlocked && <View style={s.upgradeNotice}><Text style={s.badge}>PREMIUM</Text><Pressable onPress={() => setScreen("PLANS")} accessibilityRole="button"><Text style={s.link}>View plans</Text></Pressable></View>}
      <View style={s.search}><Ionicons name="search" size={18} color="#667085" /><TextInput accessibilityLabel="Search regions" style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Search regions" /></View>
      <View style={s.card}>{rows.map((region) => { const on = selected.includes(region.code); return <Pressable key={region.code} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !unlocked }} accessibilityLabel={region.name} disabled={!unlocked} style={[s.listRow, on && s.selected, !unlocked && s.disabled]} onPress={() => {
        if (!on && selected.length >= prefs.selectionLimits.regions) { setError(`Your plan allows up to ${prefs.selectionLimits.regions} regions.`); return; }
        const next = on ? selected.filter((code) => code !== region.code) : [...selected, region.code];
        setPickerSelection(next); setError(null);
      }}><Ionicons name={on ? "checkbox" : "square-outline"} size={21} color={on ? purple : "#98A2B3"} /><Text style={s.rowTitle}>{region.name}</Text></Pressable>; })}</View>
      {!rows.length && <Text style={s.centerCopy}>No regions match your search.</Text>}
      <Text style={s.count}>{selected.length} regions selected</Text><InlineError value={error} /><Primary label={busy ? "Saving…" : "Save Selection"} onPress={async () => { if (await save({ ...draft, ...(inbound ? { inboundReach: "REGION", inboundSelectedRegions: selected } : { mode: "REGION", selectedRegions: selected }) })) setScreen("SETTINGS"); }} disabled={busy || !unlocked || selected.length === 0 || selected.length > prefs.selectionLimits.regions} />
    </Page>;
  }

  if (screen === "WORLDWIDE") return <Page busy={busy} title="Worldwide" back={() => setScreen("SETTINGS")}>
    <View style={s.globe}><Ionicons name="globe-outline" size={112} color="#4D7CFE" /><View style={s.orbitOne} /><View style={s.orbitTwo} /></View>
    <Text style={s.heroTitle}>Connect without borders</Text><Text style={s.centerCopy}>Connect with eligible users worldwide while privacy rules remain enforced.</Text>
    {!allowed("GLOBAL") && <View style={s.upgradeNotice}><Ionicons name="lock-closed" size={20} color="#D79400" /><Text style={s.noticeText}>Worldwide discovery requires Elite.</Text><Text style={[s.badge, s.eliteBadge]}>ELITE</Text></View>}
    <InlineError value={error} /><Primary label={busy ? "Saving…" : allowed("GLOBAL") ? "Save Preference" : "View Elite Plan"} disabled={busy} onPress={async () => { if (!allowed("GLOBAL")) { setSelectedPlan("ELITE"); setScreen("PLANS"); return; } if (await save({ ...draft, ...(worldwideInbound ? { inboundReach: "GLOBAL" } : { mode: "GLOBAL" }) })) setScreen("SETTINGS"); }} />
  </Page>;

  if (screen === "PLANS") return <Page busy={busy} title="Premium Plans" back={() => setScreen("SETTINGS")}>
    <View style={s.crown}><Ionicons name="sparkles" size={42} color="#E5A000" /></View><Text style={s.heroTitle}>Unlock more connections</Text>
    <Text style={s.centerCopy}>Plan access is granted only after Linqa billing confirms an active entitlement.</Text>
    <PlanCard name="Free" detail="My Country only" price="$0" active={prefs.subscriptionTier === "FREE"} selected={selectedPlan === "FREE"} onPress={() => setSelectedPlan("FREE")} features={["Verified country feed", "Basic discovery"]} />
    <PlanCard name="Premium" detail="Selected countries and regions within your plan limits" price="Billing managed" active={prefs.subscriptionTier === "PREMIUM"} selected={selectedPlan === "PREMIUM"} onPress={() => setSelectedPlan("PREMIUM")} features={["Selected countries", "Regional discovery", "Server-enforced selection limits"]} />
    <PlanCard name="Elite" detail="Worldwide discovery" price="Billing managed" active={prefs.subscriptionTier === "ELITE"} selected={selectedPlan === "ELITE"} onPress={() => setSelectedPlan("ELITE")} features={["Worldwide discovery", "Country and regional controls", "Privacy-aware discovery"]} elite />
    <Text style={s.centerCopy}>Choosing a card compares plans. Refresh after your billing change to confirm access.</Text>
    <InlineError value={error} /><Primary label={busy ? "Refreshing…" : "Refresh Plan Access"} disabled={busy} onPress={async () => {
      const generation = lifecycle.current;
      setBusy(true); setError(null); try { const next = await load(); if (!next) return; if (next.subscriptionTier === "FREE") setError("No Premium or Elite entitlement is active yet."); else setScreen("SUCCESS"); } catch { if (generation === lifecycle.current) setError("Unable to refresh plan access."); } finally { if (generation === lifecycle.current) setBusy(false); }
    }} />
    <Primary label="Plan and billing support" onPress={() => router.push("/support")} />
  </Page>;

  if (screen === "SUCCESS") return <Page busy={busy} title={prefs.subscriptionTier === "ELITE" ? "CountryLinqa Elite" : "CountryLinqa Premium"}>
    <View style={s.success}><Ionicons name="gift" size={84} color="#E5A000" /><Ionicons name="checkmark-circle" size={38} color="#17A673" /></View>
    <Text style={s.heroTitle}>{prefs.subscriptionTier} access is active</Text><Text style={s.centerCopy}>Your server-confirmed CountryLinqa discovery controls are ready.</Text>
    <Primary label="Continue" onPress={() => setScreen("SETTINGS")} />
  </Page>;

  return <Page busy={busy} title="Discovery Settings" back={() => router.back()}>
    <Text style={s.kicker}>Current Mode</Text><View style={s.summary}><Ionicons name="earth" size={27} color={purple} /><View style={s.flex}><Text style={s.summaryTitle}>{titleFor(draft.mode)}</Text><Text style={s.rowCopy}>{draft.mode === "MY_COUNTRY" ? catalog.countries.find(country => country.code === prefs.verifiedCountryCode)?.name ?? prefs.verifiedCountryCode ?? "Country verification required" : draft.mode === "SELECTED_COUNTRIES" ? `${draft.selectedCountries.length} countries selected` : draft.mode === "REGION" ? draft.selectedRegions.map(code => catalog.regions.find(region => region.code === code)?.name ?? code).join(", ") : "Worldwide discovery"}</Text></View><Pressable accessibilityRole="button" onPress={() => selectOutbound(draft.mode === "MY_COUNTRY" ? "SELECTED_COUNTRIES" : draft.mode)}><Text style={s.link}>Change</Text></Pressable></View>
    <Section title="Who I can discover">{outboundModes.map((item) => <ModeRow key={item.key} label={item.label} detail={item.detail} tier={item.tier} selected={draft.mode === item.key} allowed={allowed(item.key)} onPress={() => selectOutbound(item.key)} />)}</Section>
    <Section title="Who can discover me">{inboundModes.map((item) => <ModeRow key={item.key} label={item.label} detail={item.detail} tier={item.tier} selected={draft.inboundReach === item.key} allowed={item.key === "CONTACTS_ONLY" || allowed(item.key)} onPress={() => selectInbound(item.key)} />)}</Section>
    <Section title="Privacy">
      <Toggle label="Show country" value={draft.showCountry} onChange={(value) => setDraft({ ...draft, showCountry: value, ...(!value ? { showState: false, showCity: false } : {}) })} />
      <Toggle label="Show state/province" value={draft.showState} onChange={(value) => setDraft({ ...draft, showState: value, ...(value ? { showCountry: true } : { showCity: false }) })} />
      <Toggle label="Show city" value={draft.showCity} onChange={(value) => setDraft({ ...draft, showCity: value, ...(value ? { showState: true, showCountry: true } : {}) })} />
    </Section>
    <Section title="Recommendations">
      <Toggle label="Verified users only" value={draft.verifiedOnly} onChange={(value) => setDraft({ ...draft, verifiedOnly: value })} />
      <Toggle label="Allow business discovery" value={draft.allowBusinesses} onChange={(value) => setDraft({ ...draft, allowBusinesses: value })} />
      <Toggle label="Allow community recommendations" value={draft.allowCommunities} onChange={(value) => setDraft({ ...draft, allowCommunities: value })} />
      <Toggle label="Allow event recommendations" value={draft.allowEvents} onChange={(value) => setDraft({ ...draft, allowEvents: value })} />
    </Section>
    <Section title="Advanced"><Toggle label="Pause discovery" detail="Stop new discovery while keeping existing contacts." value={draft.paused} onChange={(value) => setDraft({ ...draft, paused: value })} /></Section>
    <View style={s.notice}><Ionicons name="shield-checkmark" size={18} color="#12805C" /><Text style={s.noticeText}>Reach and visibility never change your verified country identity.</Text></View>
    <InlineError value={error} /><Primary label={busy ? "Saving…" : "Save Changes"} onPress={() => void save()} disabled={busy} />
  </Page>;
}

function Page({ title, back, children, busy }: { title: string; back?: () => void; children: ReactNode; busy?: boolean }) { return <SafeAreaView style={s.screen}><Header title={title} back={busy ? undefined : back} /><ScrollView contentContainerStyle={s.content}><View pointerEvents={busy ? "none" : "auto"}>{children}</View></ScrollView></SafeAreaView>; }
function Header({ title, back }: { title: string; back?: () => void }) { return <View style={s.header}><Pressable style={s.headerSide} onPress={back} disabled={!back} accessibilityRole="button" accessibilityLabel="Go back"><Ionicons name="chevron-back" size={25} color={back ? "#344054" : "transparent"} /></Pressable><Text style={s.headerTitle}>{title}</Text><View style={s.headerSide} /></View>; }
function Section({ title, children }: { title: string; children: ReactNode }) { return <View><Text style={s.sectionTitle}>{title}</Text><View style={s.card}>{children}</View></View>; }
function ModeRow({ label, detail, tier, selected, allowed, onPress }: { label: string; detail: string; tier: string; selected: boolean; allowed: boolean; onPress: () => void }) { return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label} style={[s.modeRow, selected && s.selected]} onPress={onPress}><Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={22} color={selected ? purple : "#98A2B3"} /><View style={s.flex}><View style={s.labelLine}><Text style={s.rowTitle}>{label}</Text>{tier !== "FREE" && <Text style={[s.badge, tier === "ELITE" && s.eliteBadge]}>{tier}{allowed ? "" : " · UPGRADE"}</Text>}</View><Text style={s.rowCopy}>{detail}</Text></View></Pressable>; }
function Toggle({ label, detail, value, onChange }: { label: string; detail?: string; value: boolean; onChange: (value: boolean) => void }) { return <View style={s.toggleRow}><View style={s.flex}><Text style={s.rowTitle}>{label}</Text>{detail && <Text style={s.rowCopy}>{detail}</Text>}</View><Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ false: "#D0D5DD", true: "#806CF0" }} thumbColor="#fff" /></View>; }
function Primary({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) { return <Pressable accessibilityRole="button" disabled={disabled} style={[s.button, disabled && s.disabled]} onPress={onPress}><Text style={s.buttonText}>{label}</Text></Pressable>; }
function InlineError({ value }: { value: string | null }) { return value ? <Text style={s.error}>{value.replace(/_/g, " ")}</Text> : null; }
function PlanCard({ name, detail, price, active, elite, selected, onPress, features }: { name: string; detail: string; price: string; active: boolean; elite?: boolean; selected: boolean; onPress: () => void; features: string[] }) { return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${name} plan${active ? ", active" : ""}`} onPress={onPress} style={[s.plan, selected && s.planActive]}><View style={s.planTop}><View style={s.flex}><View style={s.labelLine}><Text style={s.planName}>{name}</Text>{elite && <Text style={[s.badge, s.eliteBadge]}>GLOBAL</Text>}{name === "Premium" && <Text style={s.badge}>POPULAR</Text>}</View><Text style={s.rowCopy}>{detail}</Text></View><Text style={s.planPrice}>{active ? "ACTIVE" : price}</Text></View>{features.map(feature => <View key={feature} style={s.feature}><Ionicons name="checkmark" size={16} color="#12805C" /><Text style={s.rowCopy}>{feature}</Text></View>)}</Pressable>; }
function flag(code: string) { return code.toUpperCase().replace(/./g, (character) => String.fromCodePoint(127397 + character.charCodeAt(0))); }

const s = StyleSheet.create({
  upgradeNotice: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, backgroundColor: "#F4F1FF", borderRadius: 13, padding: 13, marginBottom: 16 }, link: { color: purple, fontSize: 13, fontWeight: "800", padding: 6 }, planTop: { flexDirection: "row", alignItems: "center" }, feature: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 },
  screen: { flex: 1, backgroundColor: "#F7F8FC" }, header: { height: 62, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#EAECF0", backgroundColor: "#fff", paddingHorizontal: 12 }, headerSide: { width: 42, minHeight: 42, justifyContent: "center" }, headerTitle: { flex: 1, textAlign: "center", color: purple, fontSize: 18, fontWeight: "900" }, content: { padding: 18, paddingBottom: 48 }, loading: { flex: 1, justifyContent: "center", alignItems: "center", padding: 28 }, flex: { flex: 1 }, kicker: { color: "#667085", fontSize: 12, fontWeight: "800", letterSpacing: .7 }, summary: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", padding: 16, marginTop: 8, borderRadius: 16, borderWidth: 1, borderColor: "#E4E7EC" }, summaryTitle: { color: "#101828", fontSize: 17, fontWeight: "900" }, sectionTitle: { color: "#344054", fontSize: 13, fontWeight: "900", marginTop: 22, marginBottom: 8 }, card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#E4E7EC", borderRadius: 16, overflow: "hidden" }, modeRow: { flexDirection: "row", gap: 11, padding: 14, alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#EAECF0" }, selected: { backgroundColor: "#F4F1FF" }, labelLine: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }, rowTitle: { color: "#101828", fontSize: 14, fontWeight: "800" }, rowCopy: { color: "#667085", fontSize: 12, lineHeight: 17, marginTop: 3 }, badge: { color: "#6242D8", backgroundColor: "#EEE9FF", borderRadius: 99, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3, fontSize: 9, fontWeight: "900" }, eliteBadge: { color: "#9A6700", backgroundColor: "#FFF2CC" }, toggleRow: { minHeight: 58, flexDirection: "row", gap: 12, alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#EAECF0" }, notice: { flexDirection: "row", gap: 9, backgroundColor: "#ECFDF3", borderRadius: 13, padding: 13, marginTop: 18 }, noticeText: { flex: 1, color: "#067647", fontSize: 12, lineHeight: 17, fontWeight: "600" }, button: { height: 54, backgroundColor: purple, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 20 }, disabled: { opacity: .45 }, buttonText: { color: "#fff", fontWeight: "900", fontSize: 15 }, error: { color: "#B42318", backgroundColor: "#FEF3F2", borderRadius: 10, padding: 11, marginTop: 14, textAlign: "center" }, centerCopy: { color: "#667085", fontSize: 13, textAlign: "center", lineHeight: 19, marginBottom: 16 }, search: { height: 48, flexDirection: "row", gap: 9, alignItems: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: "#D0D5DD", borderRadius: 13, paddingHorizontal: 13, marginBottom: 8 }, searchInput: { flex: 1, color: "#101828" }, listRow: { minHeight: 58, flexDirection: "row", gap: 11, alignItems: "center", paddingHorizontal: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#EAECF0" }, flag: { fontSize: 23 }, count: { color: "#667085", fontSize: 12, textAlign: "center", marginTop: 15 }, globe: { height: 255, alignItems: "center", justifyContent: "center", position: "relative" }, orbitOne: { position: "absolute", width: 190, height: 190, borderRadius: 95, borderWidth: 2, borderColor: "#C7D7FE" }, orbitTwo: { position: "absolute", width: 225, height: 225, borderRadius: 113, borderWidth: 1, borderColor: "#E1E9FF" }, heroTitle: { color: "#101828", textAlign: "center", fontSize: 22, fontWeight: "900", marginBottom: 9 }, crown: { alignSelf: "center", width: 88, height: 88, borderRadius: 44, backgroundColor: "#FFF7D6", alignItems: "center", justifyContent: "center", marginVertical: 22 }, plan: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#E4E7EC", borderRadius: 16, padding: 16, marginBottom: 10 }, planActive: { borderWidth: 2, borderColor: purple, backgroundColor: "#F7F5FF" }, planName: { color: "#101828", fontSize: 16, fontWeight: "900" }, planPrice: { color: purple, fontSize: 12, fontWeight: "900", marginLeft: 10 }, success: { alignSelf: "center", alignItems: "center", justifyContent: "center", width: 180, height: 180, borderRadius: 90, backgroundColor: "#F5F0FF", marginTop: 65, marginBottom: 24 }
});
