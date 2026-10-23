import { useEffect, useState } from 'react';
import { AppState, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { getLocales } from 'expo-localization';
import { useTranslation } from 'react-i18next';
import { i18n, languages, resolveLanguage, type AppLanguage } from './index';

const KEY = 'linqa.app-language.v1';
type Preference = AppLanguage | 'system';
let preference: Preference = 'system';
let revision = 0;
const deviceLanguage = () => resolveLanguage(getLocales()[0]?.languageTag ?? 'en');
async function readPreference() {
  return Platform.OS === 'web' ? localStorage.getItem(KEY) : SecureStore.getItemAsync(KEY);
}
async function savePreference(value: Preference) {
  if (Platform.OS === 'web') localStorage.setItem(KEY, value);
  else await SecureStore.setItemAsync(KEY, value);
}
export function LanguageBootstrap() {
  useEffect(() => {
    let live = true;
    const initialRevision = revision;
    void readPreference().catch(() => null).then(saved => {
      if (!live || revision !== initialRevision) return;
      preference = saved === 'system' || languages.some(l => l.code === saved) ? saved as Preference : 'system';
      void i18n.changeLanguage(preference === 'system' ? deviceLanguage() : preference);
    });
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active' && preference === 'system') void i18n.changeLanguage(deviceLanguage());
    });
    return () => { live = false; listener.remove(); };
  }, []);
  return null;
}

export function LanguagePicker({ light = false }: { light?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const foreground = light ? '#FFFFFF' : '#151932';
  const choose = async (value: Preference) => {
    setSaving(true);
    setFailed(false);
    revision++;
    try {
      await savePreference(value);
      preference = value;
      await i18n.changeLanguage(value === 'system' ? deviceLanguage() : value);
      setOpen(false);
    } catch { setFailed(true); }
    finally { setSaving(false); }
  };
  return <View style={{ paddingVertical: 8 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ padding: 12, minHeight: 44 }}>
      <Text style={{ color: foreground, textAlign: 'center' }}>{t('Language')} · {languages.find(l => l.code === i18n.language)?.label ?? 'English'} ▾</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <View accessibilityViewIsModal style={{ maxHeight: '80%', backgroundColor: light ? '#3925A7' : '#FFFFFF', borderRadius: 12, padding: 8 }}>
      <ScrollView>
      {[{ code: 'system' as const, label: t('System default') }, ...languages].map(item => <Pressable key={item.code} disabled={saving} accessibilityRole="radio" accessibilityState={{ checked: preference === item.code, disabled: saving }} onPress={() => void choose(item.code)} style={{ padding: 12, minHeight: 44 }}>
        <Text style={{ color: foreground }}>{preference === item.code ? '✓ ' : ''}{item.label}</Text>
      </Pressable>)}
      {failed && <Text accessibilityRole="alert" style={{ color: foreground }}>{t('Could not save language. Try again.')}</Text>}
      </ScrollView>
      <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={{ padding: 12, minHeight: 44 }}><Text style={{ color: foreground, textAlign: 'center' }}>{t('Close')}</Text></Pressable>
      </View>
      </View>
    </Modal>
  </View>;
}
