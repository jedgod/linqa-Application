import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { WalletServicesPage, ServiceRow, useWalletResource, serviceStyles as s } from '../../components/wallet/services';
import type { WalletService } from '../../services/wallet.service';
const load = (c: WalletService) => c.services();
const destinations = new Set(['/privacy-center', '/settings/privacy-rights']);
export default function WalletSecurity() {
  const router = useRouter();
  const { data, loading, error, reload } = useWalletResource(load);
  return <WalletServicesPage title="Security & Privacy" subtitle="How your wallet is protected" loading={loading} error={error} retry={() => void reload()}>
    {data ? <>
      {data.biometricAuthorizationRequired ? <View style={s.card}><Text style={s.value}>Transaction protection</Text><Text style={s.copy}>Biometrics are required to approve wallet payments, and each approval is tied to the transaction you review.</Text></View> : null}
      <View style={s.card}><Text style={s.value}>Wallet permissions</Text>{data.permissions.includes('linqasend:read') ? <Text style={s.copy}>View wallet information</Text> : null}{data.permissions.includes('linqasend:write') ? <Text style={s.copy}>Request wallet actions (checked each time)</Text> : null}{!data.permissions.length ? <Text style={s.copy}>No wallet permissions reported.</Text> : null}</View>
      {data.securityOptions.filter(option => destinations.has(option.route)).map(option => <ServiceRow key={option.route} title={option.title} description={option.description} icon="shield-checkmark-outline" onPress={() => router.push(option.route as never)} />)}
    </> : null}
  </WalletServicesPage>;
}
