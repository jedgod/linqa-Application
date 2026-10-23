import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { WalletServicesPage, ServiceButton, useWalletResource, serviceStyles as s } from '../../components/wallet/services';
import { wallet } from '../../components/wallet/theme';
import { fonts } from '../../theme/tokens';
import type { WalletService } from '../../services/wallet.service';
const load = (c: WalletService) => c.services();
export default function WalletSupport() {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, loading, error, reload } = useWalletResource(load);
  return <WalletServicesPage title="Help & Support" subtitle="Answers and ways to reach us" loading={loading} error={error} retry={() => void reload()}>
    {data ? <>
      <Pressable accessibilityRole="button" accessibilityLabel="Ask Linqa AI" accessibilityHint="Chat with Linqa AI about how the Wallet works" style={local.ai} onPress={() => router.push('/wallet/support-chat' as never)}>
        <View style={local.aiIcon}><Ionicons name="sparkles" size={18} color={wallet.teal} /></View>
        <View style={{ flex: 1 }}>
          <Text style={local.aiTitle}>Ask Linqa AI</Text>
          <Text style={local.aiCopy}>Instant answers about how the Wallet works</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={wallet.teal} />
      </Pressable>
      {data.supportTopics.map(topic => {
        const open = expanded === topic.title;
        // The whole box is the touch target; its height follows its text (collapsed: one line, expanded: line plus answer).
        return <Pressable key={topic.title} accessibilityRole="button" accessibilityState={{ expanded: open }} style={[s.card, local.topic]} onPress={() => setExpanded(value => value === topic.title ? null : topic.title)}>
          <View style={local.head}>
            <Text style={local.title}>{topic.title}</Text>
            <Ionicons name={open ? 'remove' : 'add'} size={18} color={wallet.teal} />
          </View>
          {open ? <Text style={local.body}>{topic.body}</Text> : null}
        </Pressable>;
      })}
      {data.supportRoute === '/support' ? <ServiceButton label="Contact support" onPress={() => router.push('/support' as never)} /> : <Text style={s.copy}>No contact options are currently available.</Text>}
      <Text style={s.copy}>Never share passwords, card security codes or recovery secrets with support.</Text>
    </> : null}
  </WalletServicesPage>;
}

const local = StyleSheet.create({
  ai: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: wallet.teal, backgroundColor: wallet.tealSoft },
  aiIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: wallet.card, alignItems: 'center', justifyContent: 'center' },
  aiTitle: { color: wallet.teal, fontFamily: fonts.bold, fontSize: 14 },
  aiCopy: { color: wallet.muted, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 1 },
  topic: { paddingVertical: 12, paddingHorizontal: 14, gap: 6, borderRadius: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { flex: 1, color: wallet.text, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  body: { color: wallet.muted, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18 }
});
