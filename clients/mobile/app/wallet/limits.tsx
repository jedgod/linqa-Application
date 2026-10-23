import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { WalletServicesPage, ServiceButton, useWalletResource, serviceStyles as s } from '../../components/wallet/services';
import { moneyText } from '../../components/wallet/theme';
import type { WalletService } from '../../services/wallet.service';
const load = (c: WalletService) => c.limits();
export default function WalletTransferLimits() {
  const router = useRouter();
  const { data, loading, error, reload } = useWalletResource(load);
  return <WalletServicesPage title="Transfer Limits" subtitle="Per-operation and 24-hour limits" loading={loading} error={error || (data && !Array.isArray(data.items) ? 'Wallet limits are updating. Try again.' : '')} retry={() => void reload()}>
    {data?.items ? <>
      {!data.items.length ? <View style={s.card}><Text style={s.value}>No wallet limits yet</Text><Text style={s.copy}>Limits appear here once you open a wallet.</Text></View> : data.items.map(item => {
        const amount = (minor: string | null) => minor === null ? 'Not configured' : moneyText(minor, item.currency);
        return <View key={item.walletId} style={s.card}>
          <Text style={s.value}>{item.currency} wallet</Text><Text style={s.copy}>Status: {item.status}</Text>
          {!item.configured ? <Text style={s.copy}>Not configured yet. Money movements stay unavailable until limits are set.</Text> : <>
            <Text style={s.copy}>Per operation{data.includesFees ? ' (including fees)' : ''}: {amount(item.perOperationMinor)}</Text>
            <Text style={s.copy}>Rolling 24 hours: {amount(item.dailyMinor)}</Text>
            <Text style={s.copy}>Used {amount(item.usedMinor)} · Remaining {amount(item.remainingMinor)}</Text>
          </>}
        </View>;
      })}
      <Text style={s.copy}>Eligibility, security and provider checks still apply.</Text>
      <ServiceButton label="Limit details" onPress={() => router.push('/wallet/limit-details' as never)} />
    </> : null}
  </WalletServicesPage>;
}
