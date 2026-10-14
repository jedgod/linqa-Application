import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useAccounts } from '../../account/AccountContext';
import { accountScopeGeneration } from '../../services/account-scope';
import { saveToVault } from '../../services/vault-save';
import { VaultHeader, VaultScreen, vault } from '../../components/vault/ui';
import { fonts } from '../../theme/tokens';

export default function VaultUpload() {
  const { active } = useAccounts();
  const router = useRouter();
  const [picked, setPicked] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  const temporary = useRef<string | null>(null);
  useEffect(() => () => { if (temporary.current) { try { const file = new File(temporary.current); if (file.exists) file.delete(); } catch {} } }, []);
  async function choose() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const file = new File(asset.uri);
      if (!file.exists || !file.size || file.size > 25 * 1024 * 1024) throw new Error('Choose a nonempty file under 25 MB.');
      if (picked && picked.uri !== asset.uri) { const old = new File(picked.uri); if (old.exists) old.delete(); }
      setPicked(asset); setSaved(false);
      temporary.current = asset.uri;
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to choose a file. Try again.'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function save() {
    if (!picked || !active || pending.current || saved) return;
    pending.current = true; setBusy(true); setMessage(null);
    const generation = accountScopeGeneration();
    try {
      const file = new File(picked.uri);
      if (!file.exists || !file.size || file.size > 25 * 1024 * 1024) throw new Error('Choose a nonempty file under 25 MB.');
      const data = await file.base64();
      if (generation !== accountScopeGeneration()) return;
      await saveToVault({ accountId: active.userId, plainBase64: data, details: { name: picked.name, mimeType: picked.mimeType ?? 'application/octet-stream', kind: picked.mimeType?.startsWith('image/') ? 'PHOTO' : 'FILE' } });
      if (generation !== accountScopeGeneration()) return;
      setSaved(true); setMessage('Encrypted and saved to your Vault.');
      if (file.exists) file.delete();
    } catch (error) { if (generation === accountScopeGeneration()) setMessage(error instanceof Error ? error.message : 'Unable to save. Try again.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <VaultScreen tab="files" tabs={false}><VaultHeader title="Save to Vault" back /><View style={s.content}>
    <View style={s.art}><Ionicons name="shield-checkmark-outline" size={48} color={vault.blueText} /></View>
    <Text style={s.title}>Keep a file safe</Text><Text style={s.copy}>Choose a photo or document, up to 25 MB. Linqa encrypts it on this phone before uploading it.</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void choose()} style={s.card}><Ionicons name="document-attach-outline" size={28} color={vault.blueText} /><Text style={s.filename}>{picked?.name ?? 'Choose a file'}</Text><Text style={s.copy}>{picked?.size ? `${(picked.size / 1024 / 1024).toFixed(2)} MB` : 'Browse this device'}</Text></Pressable>
    {busy ? <ActivityIndicator color={vault.blueText} /> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={[s.copy, { color: saved ? vault.green : vault.red }]}>{message}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy || !picked || !active || saved} onPress={() => void save()} style={[s.button, (busy || !picked || saved) && { opacity: .4 }]}><Text style={s.buttonText}>{busy ? 'Saving…' : saved ? 'Saved' : 'Encrypt and save'}</Text></Pressable>
    {saved ? <Pressable accessibilityRole="button" onPress={() => router.replace('/vault/files')}><Text style={[s.copy, { color: vault.blueText }]}>Open Vault files</Text></Pressable> : null}
  </View></VaultScreen>;
}
const s = StyleSheet.create({ content: { padding: 24, gap: 22 }, art: { alignSelf: 'center', padding: 24, borderRadius: 32, backgroundColor: vault.card }, title: { color: vault.text, fontFamily: fonts.bold, fontSize: 24, textAlign: 'center' }, copy: { color: vault.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, textAlign: 'center' }, card: { alignItems: 'center', gap: 12, padding: 24, backgroundColor: vault.card, borderRadius: 20, borderWidth: 1, borderColor: vault.border }, filename: { color: vault.text, fontFamily: fonts.bold, textAlign: 'center' }, button: { backgroundColor: vault.blue, padding: 17, borderRadius: 14, alignItems: 'center' }, buttonText: { color: '#fff', fontFamily: fonts.bold } });
