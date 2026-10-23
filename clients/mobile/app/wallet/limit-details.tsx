import { Text, View } from 'react-native';
import { WalletServicesPage, useWalletResource, serviceStyles as s } from '../../components/wallet/services';
import type { WalletService } from '../../services/wallet.service';
const load = (c: WalletService) => c.limits();
const sourceLabels: Record<string, string> = { WALLET_OPERATIONS: 'Wallet money operations', BANK_CASH_OUTS: 'Bank cash-outs', LINQASEND_TRANSFERS: 'LinqaSend transfers' };
export default function WalletLimitDetails() {
  const { data, loading, error, reload } = useWalletResource(load);
  return <WalletServicesPage title="Limit Details" subtitle="How your limits are counted" loading={loading} error={error} retry={() => void reload()}>
    {data?.usageSources ? <>
      {data.period === 'ROLLING_24_HOURS' ? <View style={s.card}><Text style={s.value}>Rolling 24 hours</Text><Text style={s.copy}>Usage covers the last 24 hours and doesn’t reset at midnight.</Text></View> : null}
      <View style={s.card}><Text style={s.value}>Shared usage</Text><Text style={s.copy}>Counted together, per currency:</Text>{data.usageSources.map(source => <Text key={source} style={s.copy}>{sourceLabels[source] ?? source}</Text>)}<Text style={s.copy}>Failed and canceled operations are excluded; amounts in progress may count.</Text></View>
      {data.includesFees ? <View style={s.card}><Text style={s.value}>Fees and approval</Text><Text style={s.copy}>The per-operation limit includes fees. A shown limit doesn’t guarantee approval.</Text></View> : null}
      <Text style={s.copy}>No limit set means money movements are off, not unlimited.</Text>
    </> : null}
  </WalletServicesPage>;
}
