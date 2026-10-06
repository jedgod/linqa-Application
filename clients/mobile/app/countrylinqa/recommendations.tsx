import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { CountryButton, CountryError, CountryLoading, CountryPage, countryStyles as s, useCountryClient } from "../../components/CountryLinqaUI";
import { reasonLabel, type RankedPerson } from "../../services/countrylinqa.contract";

/** People suggested within the viewer's discovery scope. The server enforces who can appear; this screen only renders. */
export default function CountryLinqaRecommendations() {
  const client = useCountryClient();
  const router = useRouter();
  const [people, setPeople] = useState<RankedPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useFocusEffect(useCallback(() => {
    let current = true;
    setPeople(null); setError(null);
    client.recommendedPeople()
      .then((value) => { if (current) setPeople(value.items); })
      .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Unable to load suggestions"); });
    return () => { current = false; };
  }, [client, reload]));

  async function connect(id: string) {
    setBusy(id); setError(null);
    try {
      await client.connect(id);
      setPeople((old) => old?.map((p) => p.id === id ? { ...p, connectionStatus: "PENDING" } : p) ?? old);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to send request"); }
    finally { setBusy(null); }
  }

  return <CountryPage title="Suggested People">
    <Text style={s.copy}>Suggestions come from your discovery scope and the privacy settings of the people involved.</Text>
    <CountryError error={error} retry={() => setReload((n) => n + 1)} />
    {!people && !error && <CountryLoading />}
    {people?.map((person) => <View key={person.id} style={s.card}>
      <Text style={s.cardTitle}>{person.displayName}{person.verified ? "  ✓" : ""}{person.verifiedCountryCode ? `  ·  ${person.verifiedCountryCode}` : ""}</Text>
      <Text style={s.copy}>{person.reasons.map(reasonLabel).join(" · ") || "Suggested for you"}</Text>
      <CountryButton
        label={person.connectionStatus === "ACCEPTED" ? "Connected" : person.connectionStatus === "PENDING" ? "Request sent" : "Connect"}
        disabled={person.connectionStatus !== null || busy === person.id}
        onPress={() => connect(person.id)}
      />
    </View>)}
    {people?.length === 0 && <Text style={s.copy}>No suggestions yet. Add your interests and languages to get better matches.</Text>}
    <CountryButton secondary label="Edit my discovery profile" onPress={() => router.push("/countrylinqa/discovery-profile")} />
  </CountryPage>;
}
