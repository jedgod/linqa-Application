import { afterEach, describe, expect, it } from 'vitest';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { catalogs } from '../../../shared/i18n/catalogs';
import { i18n, t, formatNumber, resolveLanguage } from './index';
import { LanguagePicker } from './LanguagePicker';

afterEach(async () => { await i18n.changeLanguage('en'); });

describe('shared interface languages', () => {
  it('has matching keys and interpolation placeholders in every catalog', () => {
    const english = Object.keys(catalogs.en).sort();
    for (const catalog of Object.values(catalogs)) {
      expect(Object.keys(catalog).sort()).toEqual(english);
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim().length).toBeGreaterThan(0);
        expect(value.match(/{{\w+}}/g)).toEqual(catalogs.en[key as keyof typeof catalogs.en].match(/{{\w+}}/g));
      }
    }
  });

  it('resolves requested regional variants and falls back for unsupported languages', () => {
    expect(['fr-FR','pt-PT','pt-BR','zh-Hans-CN','ja-JP','hi-IN','es-ES','es-MX','de-DE','zh-TW'].map(resolveLanguage))
      .toEqual(['fr','pt-PT','pt-PT','zh-CN','ja','hi-IN','es-ES','es-ES','en','en']);
  });

  it('switches all requested languages, falls back, and handles counts and regional numbers', async () => {
    for (const locale of Object.keys(catalogs)) {
      await i18n.changeLanguage(locale);
      expect(t('Settings')).toBe(catalogs[locale as keyof typeof catalogs].Settings);
      expect(t('missedCalls', { count: 2 })).toContain('2');
    }
    await i18n.changeLanguage('en');
    expect(t('missedCalls', { count: 1 })).toBe('1 missed call');
    expect(t('missedCalls', { count: 2 })).toBe('2 missed calls');
    await i18n.changeLanguage('pt-PT');
    expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat('pt-PT').format(1234.5));
    await i18n.changeLanguage('de');
    expect(t('Settings')).toBe('Settings');
  });

  it('updates mounted controls without remounting or losing a draft', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    function Draft() {
      const { t } = useTranslation();
      const [draft] = useState('Unsent private message');
      return <div><label>{t('Settings')}</label><textarea readOnly value={draft} /></div>;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => { root.render(<Draft />); });
      const input = host.querySelector('textarea');
      await act(async () => { await i18n.changeLanguage('ja'); });
      expect(host.querySelector('label')?.textContent).toBe('設定');
      expect(host.querySelector('textarea')).toBe(input);
      expect(input?.value).toBe('Unsent private message');
    } finally { await act(async () => root.unmount()); }
  });

  it('persists European Portuguese and updates document language from the picker', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => root.render(<LanguagePicker />));
      const select = host.querySelector('select')!;
      await act(async () => {
        select.value = 'pt-PT';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(localStorage.getItem('linqa.app-language.v1')).toBe('pt-PT');
      expect(i18n.language).toBe('pt-PT');
      expect(document.documentElement.lang).toBe('pt-PT');
      expect(host.textContent).toContain('Idioma');
      await act(async () => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'linqa.app-language.v1', newValue: 'es-ES' }));
      });
      expect(i18n.language).toBe('es-ES');
      expect(document.documentElement.lang).toBe('es-ES');
    } finally {
      await act(async () => root.unmount());
      localStorage.removeItem('linqa.app-language.v1');
    }
  });
});
