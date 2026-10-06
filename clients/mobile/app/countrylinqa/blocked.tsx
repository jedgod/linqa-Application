import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Empty, Spinner, WorldHeader, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import { Avatar } from "../../components/linqasend/ui";
import { fonts } from "../../theme/tokens";

type Row = { userId: string; displayName: string; blockedAt: string };

/** Blocked Accounts: the people you have blocked. Unblocking lifts only your own block. */
export default function CountryLinqaBlocked() {
  const client = useCountryClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    client.blockedAccounts().then((v) => { if (active) setRows(v.items); }, (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load blocked accounts"); });
    return () => { active = false; };
  }, [client, reload]));

  function unblock(row: Row) {
    Alert.alert(`Unblock ${row.displayName}?`, "They will be able to find you and message you again, if your settings allow it.", [
      { text: "Cancel", style: "cancel" },
      { text: "Unblock", onPress: async () => {
        setBusy(row.userId); setError(null);
        try { await client.unblockAccount(row.userId); setRows((old) => old?.filter((r) => r.userId !== row.userId) ?? []); }
        catch { setError("Unable to unblock. Try again."); }
        finally { setBusy(null); }
      } }
    ]);
  }

  return (
    <WorldScreen>
      <WorldHeader title="Blocked Accounts" back />
      <ScrollView contentContainerStyle={s.content}>
        {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        {!rows && !error ? <Spinner /> : null}
        {!rows && error ? <Empty icon="cloud-offline-outline" title="Can not load" text={error} action={{ label: "Try again", onPress: () => setReload((n) => n + 1) }} /> : null}
        {rows?.map((r) => (
          <View key={r.userId} style={s.row}>
            <Avatar name={r.displayName} size={48} />
            <View style={{ flex: 1 }}><Text style={s.name}>{r.displayName}</Text><Text style={s.meta}>Blocked {new Date(r.blockedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Unblock ${r.displayName}`} accessibilityState={{ disabled: busy === r.userId }} disabled={busy === r.userId} style={s.btn} onPress={() => unblock(r)}><Text style={s.btnText}>Unblock</Text></Pressable>
          </View>
        ))}
        {rows?.length === 0 ? <Empty icon="ban-outline" title="No blocked accounts" text="People you block can not find you or message you." /> : null}
      </ScrollView>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 30 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 72, borderBottomWidth: 1, borderBottomColor: world.border },
  name: { color: world.text, fontFamily: fonts.bold, fontSize: 16 },
  meta: { color: world.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  btn: { minHeight: 40, paddingHorizontal: 16, borderRadius: 10, backgroundColor: world.soft, alignItems: "center", justifyContent: "center" },
  btnText: { color: world.purple, fontFamily: fonts.bold, fontSize: 14 },
  error: { color: world.danger, fontFamily: fonts.medium, fontSize: 14, marginTop: 8 }
});
