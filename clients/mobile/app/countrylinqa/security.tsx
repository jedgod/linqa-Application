import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { CountryButton, CountryError, CountryLoading, CountryPage, countryStyles as s, useCountryClient } from "../../components/CountryLinqaUI";
import type { CountrySecurityEvent } from "../../services/countrylinqa.service";

export default function CountryLinqaSecurity() {
  const client = useCountryClient(); const router = useRouter(); const [items, setItems] = useState<CountrySecurityEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null); const [reload, setReload] = useState(0);
  useFocusEffect(useCallback(() => { let current = true; setItems(null); setError(null); client.securityActivity().then(result => { if (current) setItems(result.items); }).catch(cause => { if (current) setError(cause.message); }); return () => { current = false; }; }, [client, reload]));
  return <CountryPage title="CountryLinqa Security"><View style={s.card}><Text style={s.cardTitle}>Your verified identity</Text><Text style={s.copy}>Discovery preferences control reach and visibility. Country identity changes require server verification and may require a security review.</Text><CountryButton label="Request country review" onPress={() => router.push("/onboarding/country-clarification")} /><CountryButton secondary label="Privacy and device security" onPress={() => router.push("/privacy-center")} /></View><CountryError error={error} retry={() => setReload(value => value + 1)} />{!items && !error && <CountryLoading />}<Text style={s.cardTitle}>Recent security activity</Text>{items?.map(item => <View key={item.id} style={s.card}><Text style={s.cardTitle}>{item.eventType.replace(/_/g, " ")}</Text><Text style={s.copy}>{item.severity} · {new Date(item.createdAt).toLocaleString()}</Text></View>)}{items?.length === 0 && <Text style={s.copy}>No recent CountryLinqa security activity.</Text>}</CountryPage>;
}
