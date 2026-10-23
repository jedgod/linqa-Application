import { useRouter } from 'expo-router';
import { WalletServicesPage, ServiceRow, SectionLabel, useWalletResource } from '../../components/wallet/services';
import type { WalletService } from '../../services/wallet.service';
const load = (client: WalletService) => client.services();
export default function WalletMore() {
  const router = useRouter();
  const { data, loading, error, reload } = useWalletResource(load);
  const open = (route: string) => () => router.push(route as never);
  return <WalletServicesPage root title="More" subtitle="Manage your wallet services" loading={loading} error={error} retry={() => void reload()}>
    {data ? <>
      <SectionLabel>Manage your wallet</SectionLabel>
      {data.services.includes('funding-methods') ? <ServiceRow title="Funding Methods" description="Linked banks and debit cards" icon="link-outline" onPress={open('/wallet/funding-methods')} /> : null}
      {data.services.includes('limits') ? <ServiceRow title="Transfer Limits" description="Your send and cash-out limits" icon="speedometer-outline" onPress={open('/wallet/limits')} /> : null}
      <SectionLabel>Statements</SectionLabel>
      {data.services.includes('reports') ? <ServiceRow title="Statements & Reports" description="Wallet statements and reports" icon="document-text-outline" onPress={open('/wallet/reports')} /> : null}
      <SectionLabel>Connected service</SectionLabel>
      {data.services.includes('cards') ? <ServiceRow accent title="LinqaSend Cards" description="Managed in LinqaSend" icon="card-outline" onPress={open('/linqasend/payment-methods')} /> : null}
      <SectionLabel>Security and help</SectionLabel>
      {data.services.includes('security') ? <ServiceRow title="Security & Privacy" description="Wallet security and permissions" icon="shield-checkmark-outline" onPress={open('/wallet/security')} /> : null}
      {data.services.includes('support') ? <ServiceRow title="Help & Support" description="Help with wallet transactions" icon="headset-outline" onPress={open('/wallet/support')} /> : null}
    </> : null}
  </WalletServicesPage>;
}
