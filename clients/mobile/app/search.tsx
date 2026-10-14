import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAccounts } from '../account/AccountContext';
import { LINQA_HUB_SERVICES } from '../navigation/information-architecture';
import { useLinqaSendAvailability } from '../services/linqasend-availability';
import { searchLinqa, type SearchResults, type SearchPerson } from '../services/search.service';
import { MobileHubService } from '../services/mobile-hub.service';
import { accessTokenProvider } from '../services/session';
import { accountScopeGeneration } from '../services/account-scope';
import { getApiBaseUrl } from '../config/api';
import { fonts, useTheme, type Palette } from '../theme/tokens';

const FILTERS = ['All', 'Chats', 'People', 'Services'] as const;
type Filter = typeof FILTERS[number];
type Icon = React.ComponentProps<typeof Ionicons>['name'];
const SETTINGS = [
  { key: 'profile', title: 'My profile', description: 'Photo, username and accounts', icon: 'person-circle-outline' as Icon, color: '#6D52E8', route: '/account/manage', group: 'Settings' },
  { key: 'settings', title: 'Settings', description: 'Privacy, security and preferences', icon: 'settings-outline' as Icon, color: '#168E80', route: '/(tabs)/settings', group: 'Settings' },
];
export default function SearchScreen() {
  const { active } = useAccounts();
  return <AccountSearch key={active?.userId ?? 'signed-out'} />;
}
function AccountSearch() {
  const router = useRouter();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const moneyAvailable = useLinqaSendAvailability() === true;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const version = useRef(0);
  const morePending = useRef(false);
  const creating = useRef(false);
  const alive = useRef(true);
  const q = query.trim();
  const remote = q.length >= 2 && filter !== 'Services';
  const kind = filter === 'Chats' ? 'chats' : filter === 'People' ? 'people' : 'all';
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    const request = ++version.current;
    controller.current?.abort();
    setResults(null); setError(null); morePending.current = false; setBusy(remote);
    if (!remote) return;
    const abort = new AbortController(); controller.current = abort;
    const timer = setTimeout(() => {
      void searchLinqa(q, kind, 0, abort.signal).then(data => {
        if (!abort.signal.aborted && request === version.current) setResults(data);
      }).catch(cause => {
        if (!abort.signal.aborted && request === version.current) setError(cause instanceof Error ? cause.message : 'Unable to search.');
      }).finally(() => { if (!abort.signal.aborted && request === version.current) setBusy(false); });
    }, 300);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [q, kind, remote, retry]);
  const shortcuts = useMemo(() => {
    if (filter === 'Chats' || filter === 'People') return [];
    return [...LINQA_HUB_SERVICES, ...SETTINGS].filter(item => (moneyAvailable || item.key !== 'send') &&
      (!q || `${item.title} ${item.description} ${item.group}`.toLowerCase().includes(q.toLowerCase())));
  }, [filter, q, moneyAvailable]);
  async function loadMore() {
    if (busy || morePending.current || results?.nextOffset == null) return;
    morePending.current = true; setBusy(true); setError(null);
    const request = version.current;
    try {
      const data = await searchLinqa(q, kind, results.nextOffset, controller.current?.signal);
      if (!alive.current || request !== version.current) return;
      setResults(previous => previous ? { ...data,
        chats: [...previous.chats, ...data.chats.filter(c => !previous.chats.some(old => old.conversationId === c.conversationId))],
        people: [...previous.people, ...data.people.filter(p => !previous.people.some(old => old.userId === p.userId))],
      } : data);
    } catch (cause) { if (alive.current && request === version.current) setError(cause instanceof Error ? cause.message : 'Unable to load more results.'); }
    finally { if (alive.current && request === version.current) { morePending.current = false; setBusy(false); } }
  }
  async function openPerson(person: SearchPerson) {
    if (creating.current) return;
    creating.current = true; setOpening(person.userId); setError(null);
    const generation = accountScopeGeneration();
    try {
      const hub = new MobileHubService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());
      const chat = await hub.createConversation(person.userId);
      if (alive.current && generation === accountScopeGeneration()) router.push({ pathname: '/modules/conversation', params: { conversationId: chat.id, peerId: person.userId, name: person.displayName } });
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Unable to open this chat.'); }
    finally { creating.current = false; if (alive.current) setOpening(null); }
  }
  function row(key: string, title: string, subtitle: string, icon: Icon, color: string, onPress: () => void, badge?: string) {
    return <Pressable key={key} accessibilityRole="button" onPress={() => { Keyboard.dismiss(); onPress(); }} style={({ pressed }) => [s.row, pressed && { opacity: .65 }]}>
      <View style={[s.icon, { backgroundColor: `${color}16` }]}><Ionicons name={icon} size={23} color={color} /></View>
      <View style={s.rowBody}><Text numberOfLines={1} style={s.rowTitle}>{title}</Text><Text numberOfLines={2} style={s.rowCopy}>{subtitle}</Text></View>
      {badge ? <Text style={s.badge}>{badge}</Text> : <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />}
    </Pressable>;
  }
  const noResults = remote && results && !results.chats.length && !results.people.length && !shortcuts.length;
  return <SafeAreaView style={s.screen}>
    <View style={s.header}><Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back"><Ionicons name="arrow-back" size={25} color={colors.text} /></Pressable><View style={s.heading}><Text style={s.title}>Search Linqa</Text><Text style={s.copy}>Your people, conversations and shortcuts</Text></View></View>
    <View style={s.search}><Ionicons name="search" size={22} color={colors.accent} /><TextInput autoFocus value={query} maxLength={100} onChangeText={setQuery} placeholder="Search by name or username" placeholderTextColor={colors.textFaint} style={s.input} returnKeyType="search" onSubmitEditing={Keyboard.dismiss} autoCorrect={false} autoCapitalize="none" accessibilityLabel="Search Linqa" />{query ? <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search"><Ionicons name="close-circle" size={21} color={colors.textMuted} /></Pressable> : null}</View>
    <View style={s.filters}>{FILTERS.map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: filter === item }} onPress={() => setFilter(item)} style={[s.chip, filter === item && s.selected]}><Text style={[s.chipText, filter === item && { color: colors.onAccent }]}>{item}</Text></Pressable>)}</View>
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={s.content}>
      {!q ? <View style={s.intro}><Ionicons name="search-outline" size={32} color={colors.accent} /><Text style={s.introTitle}>Find what you need</Text><Text style={s.introCopy}>Search your chats and connections, or jump straight to a Linqa service.</Text></View> : q.length < 2 && filter !== 'Services' ? <Text style={s.note}>Enter at least 2 characters to find chats and people.</Text> : null}
      {busy ? <View style={s.loading} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.accent} /><Text style={s.copy}>Searching…</Text></View> : null}
      {error ? <View style={s.error} accessibilityLiveRegion="polite"><Ionicons name="alert-circle-outline" size={21} color={colors.danger} /><View style={s.rowBody}><Text style={{ color: colors.danger }}>{error}</Text><Pressable onPress={() => results?.nextOffset != null ? void loadMore() : setRetry(value => value + 1)} accessibilityRole="button"><Text style={s.retry}>Try again</Text></Pressable></View></View> : null}
      {results?.chats.length ? <View><Text style={s.section}>CONVERSATIONS · {results.chats.length}</Text><View style={s.card}>{results.chats.map(chat => row(chat.conversationId, chat.title, chat.archived ? 'Archived conversation' : chat.isGroup ? 'Group conversation' : 'Direct conversation', chat.isGroup ? 'people-outline' : 'chatbubble-ellipses-outline', '#6951E8', () => router.push({ pathname: '/modules/conversation', params: { conversationId: chat.conversationId, name: chat.title, ...(chat.peerUserId ? { peerId: chat.peerUserId } : {}) } }), chat.unreadCount ? `${chat.unreadCount} unread` : undefined))}</View></View> : null}
      {results?.people.length ? <View><Text style={s.section}>PEOPLE · {results.people.length}</Text><View style={s.card}>{results.people.map(person => row(person.userId, person.displayName, person.username ? `@${person.username}` : 'Your connection', 'person-outline', '#168E80', () => void openPerson(person), opening === person.userId ? 'Opening…' : undefined))}</View></View> : null}
      {results?.nextOffset != null ? <Pressable disabled={busy} onPress={() => void loadMore()} style={s.more} accessibilityRole="button"><Text style={s.retry}>Show more results</Text></Pressable> : null}
      {shortcuts.length ? <View><Text style={s.section}>{q ? 'SERVICES & SETTINGS' : 'QUICK ACCESS'}</Text><View style={s.card}>{(q ? shortcuts : shortcuts.slice(0, 5)).map(item => row(item.key, item.title, item.description, item.icon, item.color, () => router.push(item.route as never)))}</View></View> : null}
      {(noResults || (filter === 'Services' && !!q && !shortcuts.length)) ? <View style={s.intro}><Ionicons name="search-outline" size={34} color={colors.textFaint} /><Text style={s.introTitle}>No matches found</Text><Text style={s.introCopy}>Try a different name, username or service.</Text></View> : null}
    </ScrollView>
  </SafeAreaView>;
}
const styles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg }, header: { flexDirection: 'row', gap: 18, alignItems: 'center', padding: 20, paddingBottom: 22 }, heading: { flex: 1 }, title: { fontFamily: fonts.extrabold, fontSize: 25, color: c.text }, copy: { fontFamily: fonts.regular, color: c.textMuted, fontSize: 12, marginTop: 5 },
  search: { marginHorizontal: 20, flexDirection: 'row', gap: 12, paddingHorizontal: 16, minHeight: 56, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, borderRadius: 18, alignItems: 'center' }, input: { flex: 1, color: c.text, fontFamily: fonts.medium, fontSize: 14, paddingVertical: 15 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 16 }, chip: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }, selected: { backgroundColor: c.accent, borderColor: c.accent }, chipText: { fontFamily: fonts.bold, color: c.textMuted, fontSize: 12 },
  content: { padding: 20, paddingTop: 0, paddingBottom: 50, gap: 14 }, section: { color: c.textMuted, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.3, marginTop: 10, marginBottom: 12 }, card: { borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, overflow: 'hidden' }, row: { flexDirection: 'row', gap: 12, padding: 15, alignItems: 'center', minHeight: 76, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }, rowBody: { flex: 1 }, icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, rowTitle: { fontFamily: fonts.bold, color: c.text, fontSize: 14 }, rowCopy: { fontFamily: fonts.regular, color: c.textMuted, fontSize: 11, lineHeight: 17, marginTop: 4 }, badge: { color: c.accent, fontFamily: fonts.bold, fontSize: 10, maxWidth: 72 },
  intro: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 18, gap: 10 }, introTitle: { fontFamily: fonts.bold, fontSize: 20, color: c.text }, introCopy: { textAlign: 'center', color: c.textMuted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21 }, note: { color: c.textMuted, fontSize: 12, padding: 15 }, loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 14 }, error: { flexDirection: 'row', gap: 10, padding: 15, backgroundColor: c.dangerBg, borderRadius: 14 }, retry: { color: c.accent, fontFamily: fonts.bold, fontSize: 13, paddingVertical: 10 }, more: { alignItems: 'center', padding: 5 },
});
