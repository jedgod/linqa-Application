import { useState } from "react";
import { SafeAreaView, StyleSheet, Text, Pressable, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { MultiAccountApiService } from "../../services/multi-account.service";
import { accessTokenProvider } from "../../services/session";
import { AccountSecureStorage } from "../../account/AccountSecureStorage";
import { AccountSessionStore } from "../../account/AccountSessionStore";
import { getOrCreateInstallationPublicId, currentPlatform } from "../../account/InstallationIdentity";
import { cacheInstallationServerId, getCachedInstallationServerId } from "../../account/InstallationRegistry";
import { useAccounts } from "../../account/AccountContext";
import { ErrorBanner } from "../../components/ErrorBanner";
import { colors, radius } from "../../theme/tokens";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";
const secure = new AccountSecureStorage();
const sessions = new AccountSessionStore(secure);

async function resolveInstallationId(client: MultiAccountApiService): Promise<string> {
  const cached = await getCachedInstallationServerId();
  if (cached) return cached;
  const installation = await client.registerInstallation(await getOrCreateInstallationPublicId(), currentPlatform());
  await cacheInstallationServerId(installation.id);
  return installation.id;
}

export default function RemoveAccountScreen() {
  const { userId, displayName } = useLocalSearchParams<{ userId: string; displayName?: string }>();
  const { accounts, setAccounts } = useAccounts();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      const client = new MultiAccountApiService(API_BASE_URL, () => accessTokenProvider.getAccessToken());
      const installationId = await resolveInstallationId(client);
      await client.removeAccount(installationId, userId);
      await Promise.all([sessions.remove(userId), secure.destroyAccount(userId)]);
      setAccounts(accounts.filter((a) => a.userId !== userId));
      router.replace("/account/manage");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove this account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.screen}>
      <Text style={s.top}>Remove Account</Text>
      <View style={s.p}>
        <View style={s.av}>
          <Text style={s.avt}>{(displayName ?? "?")[0]?.toUpperCase() ?? "?"}</Text>
        </View>
        <Text style={s.n}>{displayName ?? "This account"}</Text>
      </View>
      <Text style={s.c}>All data for this account on this device will be removed.</Text>
      <ErrorBanner message={error} />
      <Pressable style={[s.remove, busy && s.disabled]} disabled={busy} onPress={handleRemove}>
        <Text style={s.rt}>{busy ? "Removing…" : "Remove Account"}</Text>
      </Pressable>
      <Pressable style={s.cancel} onPress={() => router.back()}>
        <Text style={s.ct}>Cancel</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 22, paddingTop: 46 },
  top: { color: colors.danger, fontWeight: "800", textAlign: "center", marginBottom: 28 },
  p: { flexDirection: "row", gap: 12, alignItems: "center" },
  av: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  avt: { color: colors.text, fontWeight: "900" },
  n: { color: colors.text, fontWeight: "900" },
  c: { color: colors.textMuted, lineHeight: 20, marginVertical: 28 },
  remove: { height: 52, borderRadius: radius.md, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.6 },
  rt: { color: colors.onAccent, fontWeight: "900" },
  cancel: { height: 52, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", marginTop: 14 },
  ct: { color: colors.text, fontWeight: "800" }
});
