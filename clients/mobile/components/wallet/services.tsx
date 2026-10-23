import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { wallet, WalletHeader, WalletTabBar } from './theme';
import { fonts } from '../../theme/tokens';
import { WalletService } from '../../services/wallet.service';
import { accessTokenProvider } from '../../services/session';
import { getApiBaseUrl } from '../../config/api';
import { useAccounts } from '../../account/AccountContext';
import { useWalletDemo } from '../../services/wallet-demo-mode';

/** A result never survives an account switch or a newer request. */
export function useWalletResource<T>(loader: (client: WalletService) => Promise<T>) {
  const { active } = useAccounts();
  const userId = active?.userId;
  const demo = useWalletDemo();
  const owner = useRef(userId); owner.current = userId;
  const sequence = useRef(0);
  const client = useMemo(() => new WalletService(getApiBaseUrl(), async () => {
    if (!userId || owner.current !== userId) throw new Error('Account changed');
    const token = await accessTokenProvider.getAccessToken();
    if (owner.current !== userId) throw new Error('Account changed');
    return token;
  }), [userId]);
  const [result, setResult] = useState<{ owner: string | undefined; value: T } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true); setError(''); setResult(null);
    try {
      const value = await loader(client);
      if (request === sequence.current && owner.current === userId) setResult({ owner: userId, value });
    } catch {
      if (request === sequence.current && owner.current === userId) setError('We couldn’t load this wallet service. Check your connection and try again.');
    } finally { if (request === sequence.current) setLoading(false); }
  }, [client, loader, userId, demo]);
  useFocusEffect(useCallback(() => { void reload(); return () => { sequence.current++; }; }, [reload]));
  return { client, userId, owner, data: result?.owner === userId ? result?.value ?? null : null, error, loading, reload };
}

/**
 * Shared frame for the wallet's "More" pages. Compact by design: a single-line heading (with a back arrow on detail pages),
 * a one-line subtitle, and tight cards, so a page's usual content fits one screen. Long lists still scroll.
 */
export function WalletServicesPage({ title, subtitle, children, loading, error, retry, root = false }:
  { title: string; subtitle: string; children?: ReactNode; loading?: boolean; error?: string; retry?: () => void; root?: boolean }) {
  const router = useRouter();
  return <SafeAreaView style={serviceStyles.screen}>
    <StatusBar style="light" />
    <WalletHeader title={title} onBack={root ? undefined : () => (router.canGoBack() ? router.back() : router.replace('/wallet/more' as never))} />
    <ScrollView style={{ flex: 1 }} contentContainerStyle={serviceStyles.content}>
      <Text style={serviceStyles.subtitle} numberOfLines={1}>{subtitle}</Text>
      {loading ? <View style={serviceStyles.state}><ActivityIndicator size="large" color={wallet.teal} /><Text style={serviceStyles.copy}>Loading…</Text></View>
        : error ? <View style={serviceStyles.card} accessibilityRole="alert"><Text style={serviceStyles.copy}>{error}</Text><ServiceButton label="Try again" onPress={retry!} /></View>
        : children}
    </ScrollView>
    <WalletTabBar active="more" />
  </SafeAreaView>;
}

export function ServiceRow({ title, description, icon, onPress, accent = false }:
  { title: string; description: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; accent?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${description}`} style={({ pressed }) => [serviceStyles.row, accent && serviceStyles.accent, pressed && { opacity: 0.75 }]} onPress={onPress}>
    <View style={serviceStyles.icon}><Ionicons name={icon} size={24} color={wallet.teal} /></View>
    <View style={{ flex: 1, gap: 1 }}><Text style={serviceStyles.rowTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{title}</Text><Text style={serviceStyles.rowCopy} numberOfLines={2}>{description}</Text></View>
    <Ionicons name="chevron-forward" size={20} color={wallet.teal} />
  </Pressable>;
}
export function ServiceButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} style={[serviceStyles.button, disabled && { opacity: 0.5 }]} onPress={onPress}><Text style={serviceStyles.buttonText}>{label}</Text></Pressable>;
}
export function SectionLabel({ children }: { children: ReactNode }) { return <Text accessibilityRole="header" style={serviceStyles.section}>{children}</Text>; }

export const serviceStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: wallet.bg },
  content: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 12, gap: 8 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  back: { width: 40, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  title: { flex: 1, color: wallet.text, fontFamily: fonts.extrabold, fontSize: 28, lineHeight: 34 },
  titleRoot: { flex: 0, fontSize: 32, lineHeight: 38, marginTop: 6 },
  subtitle: { color: wallet.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginBottom: 2 },
  subtitleIndented: { marginTop: -6, marginLeft: 46 },
  section: { fontFamily: fonts.semibold, fontSize: 12, color: wallet.muted, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, backgroundColor: wallet.card, borderColor: wallet.cardBorder, borderWidth: 1, borderRadius: 14 },
  accent: { borderColor: wallet.teal, backgroundColor: wallet.tealSoft },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: wallet.bg, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: wallet.text, fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 },
  rowCopy: { color: wallet.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  copy: { color: wallet.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: wallet.card, padding: 14, borderRadius: 14, borderColor: wallet.cardBorder, borderWidth: 1, gap: 6 },
  value: { color: wallet.text, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  link: { color: wallet.teal, fontFamily: fonts.semibold, fontSize: 15 },
  button: { backgroundColor: wallet.teal, borderRadius: 10, paddingHorizontal: 14, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: wallet.onTeal, fontFamily: fonts.bold, fontSize: 14, textAlign: 'center' },
  state: { gap: 14, paddingVertical: 40, alignItems: 'center' }
});
