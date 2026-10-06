import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { CountryButton, CountryError, CountryInput, CountryLoading, CountryPage, countryStyles as s, useCountryClient } from "../../components/CountryLinqaUI";
import type { CountryProfile } from "../../services/countrylinqa.service";
import { useAccounts } from "../../account/AccountContext";

export default function CountryLinqaProfile() {
  const client = useCountryClient(); const router = useRouter(); const { accounts, active, setAccounts } = useAccounts();
  const [profile, setProfile] = useState<CountryProfile | null>(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false); const [reload, setReload] = useState(0);
  useFocusEffect(useCallback(() => { let current = true; setProfile(null); setError(null); setSaved(false); client.profile().then(value => { if (current) setProfile(value); }).catch(cause => { if (current) setError(cause.message); }); return () => { current = false; }; }, [client, reload]));
  async function save() { if (!profile) return; setBusy(true); setError(null); try { const next = await client.saveProfile({ displayName: profile.displayName.trim(), bio: profile.bio.trim() }); setProfile(next); setSaved(true); if (active?.userId === next.id) setAccounts(accounts.map(account => account.userId === next.id ? { ...account, displayName: next.displayName } : account)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save profile"); } finally { setBusy(false); } }
  return <CountryPage title="My Profile"><CountryError error={error} retry={() => setReload(value => value + 1)} />{!profile && !error && <CountryLoading />}
    {profile && <View style={s.card}><Text style={s.title}>{profile.displayName}</Text><Text style={s.copy}>{profile.verifiedCountryCode ?? "Country unconfirmed"} · {profile.verificationState.replace(/_/g, " ")}</Text><CountryInput label="Display name" value={profile.displayName} onChange={displayName => { setProfile({ ...profile, displayName }); setSaved(false); }} /><CountryInput label="About me" value={profile.bio} onChange={bio => { setProfile({ ...profile, bio }); setSaved(false); }} /><CountryButton label={busy ? "Saving…" : saved ? "Profile saved" : "Save profile"} disabled={busy || saved || !profile.displayName.trim()} onPress={() => void save()} /></View>}
    <CountryButton secondary label="Account settings" onPress={() => router.push("/account/settings")} /><CountryButton secondary label="Security" onPress={() => router.push("/countrylinqa/security")} /><CountryButton secondary label="Plans and subscription" onPress={() => router.push("/settings/countrylinqa?view=PLANS")} /><CountryButton secondary label="Help and support" onPress={() => router.push("/support")} />
  </CountryPage>;
}
