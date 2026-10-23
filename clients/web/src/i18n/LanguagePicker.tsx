import { useTranslation } from 'react-i18next';
import { i18n, languages, resolveLanguage } from './index';

const KEY = 'linqa.app-language.v1';
let preference = 'system';
const systemLanguage = () => resolveLanguage(navigator.languages?.[0] ?? navigator.language ?? 'en');
try { const saved = localStorage.getItem(KEY); if (saved === 'system' || languages.some(l => l.code === saved)) preference = saved!; } catch { /* Device language still works with storage disabled. */ }
void i18n.changeLanguage(preference === 'system' ? systemLanguage() : preference);
const updateDocument = () => { document.documentElement.lang = i18n.language; document.documentElement.dir = 'ltr'; };
i18n.on('languageChanged', updateDocument);
updateDocument();
window.addEventListener('languagechange', () => { if (preference === 'system') void i18n.changeLanguage(systemLanguage()); });
window.addEventListener('storage', event => {
  if (event.key !== KEY) return;
  preference = languages.some(l => l.code === event.newValue) ? event.newValue! : 'system';
  void i18n.changeLanguage(preference === 'system' ? systemLanguage() : preference);
});

export function LanguagePicker() {
  const { t } = useTranslation();
  return <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8, flexWrap: 'wrap' }}>
    {t('Language')}
    <select aria-label={t('Language')} value={preference} onChange={event => {
      preference = event.target.value;
      try { localStorage.setItem(KEY, preference); } catch { /* Keep the session choice when browser storage is unavailable. */ }
      void i18n.changeLanguage(preference === 'system' ? systemLanguage() : preference);
    }}>
      <option value="system">{t('System default')}</option>
      {languages.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
    </select>
  </label>;
}
