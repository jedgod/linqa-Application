import { Text, View } from 'react-native';
import { WalletServicesPage, SectionLabel, useWalletResource, serviceStyles as s } from '../../components/wallet/services';
import type { WalletService } from '../../services/wallet.service';
const load = async (c: WalletService) => { const [profile, balances, services] = await Promise.all([c.profile(), c.balances(), c.services()]); return { profile, wallets: balances.items, services }; };
export default function WalletCurrencies() {
  const { data, loading, error, reload } = useWalletResource(load);
  return <WalletServicesPage title="Wallets & Currencies" subtitle="Your wallets and eligible currencies" loading={loading} error={error} retry={() => void reload()}>
    {data ? <>
      {data.profile.country ? <View style={s.card}><Text style={s.value}>{data.profile.country.name}</Text><Text style={s.copy}>{data.profile.country.source === 'VERIFIED_PROFILE' ? 'From your verified profile.' : 'From your account settings.'} Travel doesn’t change your wallets.</Text></View> : null}
      <SectionLabel>Your wallets</SectionLabel>
      {!data.wallets.length ? <Text style={s.copy}>No wallet opened yet.</Text> : data.wallets.map(w => <View key={w.id} style={s.card}><Text style={s.value}>{w.currency}</Text><Text style={s.copy}>Status: {w.status}</Text></View>)}
      <SectionLabel>Eligible currencies</SectionLabel>
      {!data.profile.currencies.some(c => c.available) ? <Text style={s.copy}>None available right now.</Text> : data.profile.currencies.filter(c => c.available).map(c => <View key={c.code} style={s.card}><Text style={s.value}>{c.code} · {c.name}</Text>{c.isDefault ? <Text style={s.copy}>Default currency for your wallet country</Text> : null}</View>)}
      <Text style={s.copy}>Display currency can’t be changed yet. Viewing this page changes nothing.</Text>
    </> : null}
  </WalletServicesPage>;
}
