import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { WalletServicesPage, ServiceButton, useWalletResource, serviceStyles as s } from '../../components/wallet/services';
import { wallet } from '../../components/wallet/theme';
import type { WalletService } from '../../services/wallet.service';
const load = (c: WalletService) => c.reportOptions();
export default function WalletReports() {
  const { client, data, userId, owner, loading, error, reload } = useWalletResource(load);
  const [period, setPeriod] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const fileRef = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; setPeriod(''); setMessage(''); setFile(null); setBusy(false); return () => { mounted.current = false; const uri = fileRef.current; fileRef.current = null; if (uri) void FileSystem.deleteAsync(uri, { idempotent: true }); }; }, [userId]);
  const selected = data?.periods.some(p => p.period === period) ? period : data?.periods[0]?.period;
  async function download() {
    if (!selected || busy) return;
    const account = userId;
    setBusy(true); setMessage('Preparing your transaction report…'); setFile(null);
    try {
      const report = await client.report(selected);
      if (!mounted.current || owner.current !== account) return;
      if (report.status !== 'READY' || report.content === null || !report.filename) {
        setMessage(report.status === 'EMPTY' ? 'No transactions were found for this period. Refresh available reports.' : 'This period is too large for a complete download. Contact support for an extended report.'); return;
      }
      if (!FileSystem.cacheDirectory) throw new Error('File storage is unavailable');
      const uri = `${FileSystem.cacheDirectory}wallet-transactions-${selected}-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(uri, report.content, { encoding: FileSystem.EncodingType.UTF8 });
      if (!mounted.current || owner.current !== account) { await FileSystem.deleteAsync(uri, { idempotent: true }); return; }
      if (fileRef.current) await FileSystem.deleteAsync(fileRef.current, { idempotent: true });
      fileRef.current = uri; setFile(uri); setMessage('Downloaded. Save or share your CSV transaction report.');
    } catch { if (mounted.current && owner.current === account) setMessage('The report couldn’t be downloaded. Try again.'); }
    finally { if (mounted.current && owner.current === account) setBusy(false); }
  }
  async function share() {
    if (!file) return;
    try { if (!await Sharing.isAvailableAsync()) { setMessage('Saving or sharing files is unavailable on this device.'); return; } await Sharing.shareAsync(file, { mimeType: 'text/csv', dialogTitle: 'Save wallet transaction report', UTI: 'public.comma-separated-values-text' }); }
    catch { setMessage('The share sheet couldn’t be opened. Your download is still available.'); }
  }
  return <WalletServicesPage title="Statements & Reports" subtitle="Monthly activity reports (CSV)" loading={loading} error={error} retry={() => void reload()}>
    {data ? <>
      <View style={s.card}><Text style={s.value}>Monthly CSV reports</Text><Text style={s.copy}>Periods use {data.timezone}. Activity reports, not certified balance statements.</Text></View>
      {!data.periods.length ? <View style={s.card}><Text style={s.value}>No reports yet</Text><Text style={s.copy}>Reports appear after your first wallet transaction.</Text><ServiceButton label="Check again" onPress={() => void reload()} /></View> : <>
        <View accessibilityRole="radiogroup" style={{ gap: 10 }}>{data.periods.map(p => <Pressable key={p.period} accessibilityRole="radio" disabled={busy} accessibilityState={{ checked: selected === p.period, disabled: busy }} onPress={() => { setPeriod(p.period); setMessage(''); setFile(null); }} style={[s.card, selected === p.period && { borderColor: wallet.teal }]}><Text style={s.value}>{new Date(`${p.period}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</Text><Text style={s.copy}>{p.count} recorded transaction{p.count === 1 ? '' : 's'}</Text></Pressable>)}</View>
        <ServiceButton label={busy ? 'Preparing report…' : 'Download CSV report'} disabled={busy || !selected || !data.formats.includes('CSV')} onPress={() => void download()} />
      </>}
      {busy ? <ActivityIndicator color={wallet.teal} /> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={s.copy}>{message}</Text> : null}
      {file ? <ServiceButton label="Save or share report" onPress={() => void share()} /> : null}
    </> : null}
  </WalletServicesPage>;
}
