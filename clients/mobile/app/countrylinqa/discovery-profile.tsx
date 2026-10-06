import { useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { CountryButton, CountryError, CountryInput, CountryLoading, CountryPage, countryStyles as s, useCountryClient } from "../../components/CountryLinqaUI";

const INTERESTS = ["technology", "travel", "education", "business", "music", "sports", "culture"];
const LANGUAGES = ["english", "french", "spanish", "arabic", "twi", "japanese"];

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={label} onPress={onPress}
    style={[s.chip, selected && { backgroundColor: "#DDD6FF" }]}><Text style={s.copy}>{selected ? "✓ " : ""}{label}</Text></Pressable>;
}

/**
 * What you share here only changes how suggestions are ranked and lets you opt
 * out of being suggested. It never changes who you can discover or who can discover you.
 */
export default function CountryLinqaDiscoveryProfile() {
  const client = useCountryClient();
  const [languages, setLanguages] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [profession, setProfession] = useState("");
  const [discoverable, setDiscoverable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    client.discoveryFeatures().then((value) => {
      if (!current) return;
      setLanguages(value.languages); setInterests(value.interests);
      setProfession(value.professionCode ?? ""); setDiscoverable(value.discoverable); setLoaded(true);
    }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Unable to load your discovery profile"); });
    return () => { current = false; };
  }, [client]);

  const toggle = (value: string, list: string[], set: (next: string[]) => void) => {
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
    setSaved(false);
  };

  async function save() {
    setBusy(true); setError(null);
    try {
      await client.saveDiscoveryFeatures({ languages, interests, professionCode: profession.trim() ? profession.trim().toLowerCase() : null, discoverable });
      setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save"); }
    finally { setBusy(false); }
  }

  return <CountryPage title="My Discovery Profile">
    <Text style={s.copy}>Used to rank suggestions. It does not change your discovery reach.</Text>
    <CountryError error={error} />
    {!loaded && !error && <CountryLoading />}
    {loaded && <>
      <Text style={s.label}>Languages</Text>
      <View style={s.chips}>{LANGUAGES.map((l) => <Chip key={l} label={l} selected={languages.includes(l)} onPress={() => toggle(l, languages, setLanguages)} />)}</View>
      <Text style={s.label}>Interests</Text>
      <View style={s.chips}>{INTERESTS.map((i) => <Chip key={i} label={i} selected={interests.includes(i)} onPress={() => toggle(i, interests, setInterests)} />)}</View>
      <CountryInput label="Profession" value={profession} onChange={(value) => { setProfession(value); setSaved(false); }} placeholder="e.g. software engineer" />
      <View style={[s.card, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
        <View style={{ flex: 1, paddingRight: 12 }}><Text style={s.cardTitle}>Suggest me to others</Text><Text style={s.copy}>Turn off to stay out of suggestions and search results.</Text></View>
        <Switch accessibilityLabel="Suggest me to others" value={discoverable} onValueChange={(value) => { setDiscoverable(value); setSaved(false); }} />
      </View>
      <CountryButton label={busy ? "Saving…" : saved ? "Saved" : "Save"} disabled={busy} onPress={save} />
    </>}
  </CountryPage>;
}
