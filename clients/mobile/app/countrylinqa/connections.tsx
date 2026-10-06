import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { CountryButton, CountryError, CountryLoading, CountryPage, countryStyles as s, useCountryClient } from "../../components/CountryLinqaUI";
import type { CountryConnection } from "../../services/countrylinqa.service";

export default function CountryLinqaConnections() {
  const client = useCountryClient(); const [items, setItems] = useState<CountryConnection[] | null>(null);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null); const [reload, setReload] = useState(0);
  useFocusEffect(useCallback(() => { let current = true; setItems(null); setError(null); setBusy(null); client.connections().then(result => { if (current) setItems(result.items); }).catch(cause => { if (current) setError(cause.message); }); return () => { current = false; }; }, [client, reload]));
  async function resolve(id: string, action: "ACCEPT" | "DECLINE" | "CANCEL") {
    setBusy(id); setError(null);
    try { await client.resolveConnection(id, action); setReload(value => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update request"); }
    finally { setBusy(null); }
  }
  return <CountryPage title="Connections"><CountryError error={error} retry={() => setReload(value => value + 1)} />{!items && !error && <CountryLoading />}
    {items?.map(item => <View key={item.id} style={s.card}><Text style={s.cardTitle}>{item.displayName}</Text><Text style={s.copy}>{item.status === "ACCEPTED" ? "Connected" : item.incoming ? "Wants to connect with you" : "Request sent"}</Text>{item.status === "PENDING" && (item.incoming ? <><CountryButton disabled={!!busy} label="Accept" onPress={() => void resolve(item.id, "ACCEPT")} /><CountryButton secondary disabled={!!busy} label="Decline" onPress={() => void resolve(item.id, "DECLINE")} /></> : <CountryButton secondary disabled={!!busy} label="Cancel request" onPress={() => void resolve(item.id, "CANCEL")} />)}</View>)}
    {items?.length === 0 && <Text style={s.copy}>No connection requests yet.</Text>}
  </CountryPage>;
}
