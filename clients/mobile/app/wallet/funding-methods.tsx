import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { WalletServicesPage, ServiceButton, useWalletResource, serviceStyles as s } from '../../components/wallet/services';
import type { WalletService } from '../../services/wallet.service';
const load = async (c: WalletService) => { const [methods, services] = await Promise.all([c.fundingMethods(), c.services()]); return { methods: methods.items, services }; };
export default function FundingMethods() {
  const router = useRouter();
  const { data, loading, error, reload } = useWalletResource(load);
  return <WalletServicesPage title="Funding Methods" subtitle="Linked banks and debit cards" loading={loading} error={error} retry={() => void reload()}>
    {data ? <>
      {!data.methods.length ? <View style={s.card}><Text style={s.value}>No linked methods yet</Text><Text style={s.copy}>Linked banks and debit cards will appear here.</Text></View> : data.methods.map(method =>
        <View key={method.id} style={s.card}><Text style={s.value}>{method.type === 'BANK_ACCOUNT' ? 'Bank account' : 'Debit funding method'}{method.last4 ? ` ending ${method.last4}` : ''}</Text><Text style={s.copy}>Status: {method.status}</Text></View>)}
      {data.services.linkMethodSupported ? <ServiceButton label="Link a method" onPress={() => router.push({ pathname: '/wallet/link-bank', params: { from: 'more' } } as never)} /> : <Text style={s.copy}>Secure linking is not currently available for this account.</Text>}
      <ServiceButton label="Refresh methods" onPress={() => void reload()} />
    </> : null}
  </WalletServicesPage>;
}
