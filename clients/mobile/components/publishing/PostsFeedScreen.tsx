// Posts feed. Layout and structure follow the supplied PostsFeedScreen.tsx (header "Linqa Discover", post cards with author row,
// text, picture and a map with a location label), with these changes so it runs in this app:
//  - styles are React Native StyleSheet (the supplied file used Tailwind class names, which this app does not have), and the
//    stray <div> became a <View>;
//  - the map is the plain Linqa map (tap to enlarge) instead of Google Maps, which needs a key and a native build;
//  - posts come from the publishing server instead of sample data, and each shows its tagged people and feeling.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, RefreshControl, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getApiBaseUrl } from '../../config/api';
import { accessTokenProvider } from '../../services/session';
import { bytesToBase64 } from '../../services/secure-core';
import { PersonAvatar } from '../account/PersonAvatar';
import { PlainLocationMap } from './PlainLocationMap';

interface FeedPost {
  id: string;
  author: string;
  authorId: string;
  timestamp: string;
  content: string;
  title: string;
  media: Array<{ id: string; kind: 'image' | 'video'; mimeType: string }>;
  tagged: Array<{ userId: string; name: string }>;
  feeling: string | null;
  location: { latitude: number; longitude: number; title: string } | null;
  mine: boolean;
}

type Row = {
  id: string; title: string; description: string; venue_name: string | null; creator_id: string; creator_name: string | null;
  created_at: string; latitude: number | null; longitude: number | null; feeling_activity: string | null;
  media: FeedPost['media']; tagged: FeedPost['tagged'];
};

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return days < 8 ? `${days} day${days === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A post's picture. The server only serves it to people allowed to see the post, so it is fetched with the sign-in token. */
function PostPicture({ media }: { media: FeedPost['media'][number] }) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (media.kind !== 'image') return;
    let alive = true;
    (async () => {
      try {
        const token = await accessTokenProvider.getAccessToken();
        const response = await fetch(`${getApiBaseUrl()}/api/publishing/media/${media.id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error('unavailable');
        const bytes = new Uint8Array(await response.arrayBuffer());
        const data = `data:${media.mimeType};base64,${bytesToBase64(bytes)}`;
        if (alive) setUri(data);
      } catch { if (alive) setFailed(true); }
    })();
    return () => { alive = false; };
  }, [media.id, media.kind, media.mimeType]);
  if (media.kind === 'video') return <View style={[styles.image, styles.center]}><Ionicons name="videocam" size={34} color="#9A97A6" /><Text style={styles.muted}>Video</Text></View>;
  if (failed) return <View style={[styles.image, styles.center]}><Text style={styles.muted}>Picture unavailable</Text></View>;
  return uri ? <Image source={{ uri }} style={styles.image} resizeMode="cover" accessibilityLabel="Post picture" /> : <View style={[styles.image, styles.center]}><ActivityIndicator color="#9A97A6" /></View>;
}

export default function PostsFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await accessTokenProvider.getAccessToken();
      const response = await fetch(`${getApiBaseUrl()}/api/publishing/events?limit=50`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('unavailable');
      const { events } = (await response.json()) as { events: Row[] };
      const me = JSON.parse(atobSafe(token.split('.')[1] ?? ''))?.sub as string | undefined;
      setPosts(events.map((e) => ({
        id: e.id, author: e.creator_name ?? 'Linqa user', authorId: e.creator_id, timestamp: ago(e.created_at),
        title: e.title, content: e.description, media: e.media ?? [], tagged: e.tagged ?? [], feeling: e.feeling_activity,
        location: e.latitude != null && e.longitude != null ? { latitude: Number(e.latitude), longitude: Number(e.longitude), title: e.venue_name || 'Location' } : null,
        mine: e.creator_id === me,
      })));
    } catch { setError('Could not load posts. Pull down to try again.'); setPosts((now) => now ?? []); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const renderPostItem = ({ item }: { item: FeedPost }) => (
    <View style={styles.card}>
      {/* Header profile frame */}
      <View style={styles.cardHead}>
        <PersonAvatar name={item.author} userId={item.authorId} size={40} />
        <View style={styles.headText}>
          <Text style={styles.author}>{item.author}{item.mine ? ' (you)' : ''}</Text>
          <Text style={styles.time}>{item.timestamp}</Text>
        </View>
      </View>

      {/* Feeling and tagged people */}
      {(item.feeling || item.tagged.length > 0) ? (
        <View style={styles.tagsRow}>
          {item.feeling ? <View style={styles.chip}><Text style={styles.chipText}>{item.feeling}</Text></View> : null}
          {item.tagged.map((t) => <View key={t.userId} style={styles.chip}><Text style={styles.chipText}>with {t.name}</Text></View>)}
        </View>
      ) : null}

      {/* Main text content */}
      <View style={styles.body}>
        <Text style={styles.title}>{item.title}</Text>
        {item.content ? <Text style={styles.content}>{item.content}</Text> : null}
      </View>

      {/* Pictures */}
      {item.media.map((m) => <PostPicture key={m.id} media={m} />)}

      {/* Post map: plain Linqa map, tap to enlarge */}
      {item.location ? (
        <View style={styles.mapBox}>
          <PlainLocationMap latitude={item.location.latitude} longitude={item.location.longitude} height={176} label={item.location.title} />
          <View style={styles.hud} pointerEvents="none">
            <View style={styles.hudDot} />
            <Text numberOfLines={1} style={styles.hudText}>{item.location.title}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      {/* Top banner navigation row */}
      <View style={styles.topBar}>
        <Text style={styles.heading}>Linqa Discover</Text>
        <TouchableOpacity onPress={() => router.replace('/(tabs)/home')} accessibilityRole="button" accessibilityLabel="Close" style={styles.closeBtn}>
          <Ionicons name="close" size={22} color="#1D4ED8" />
        </TouchableOpacity>
      </View>

      {posts === null ? <ActivityIndicator style={{ marginTop: 40 }} color="#6041B8" /> : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={renderPostItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 30 + insets.bottom }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
          ListEmptyComponent={<Text style={[styles.muted, { textAlign: 'center', marginTop: 40 }]}>{error ?? 'No posts yet. Use Post on Home to share the first one.'}</Text>}
        />
      )}
    </SafeAreaView>
  );
}

function atobSafe(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  try { return decodeURIComponent(Array.from(globalThis.atob(b64), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')); } catch { return '{}'; }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  topBar: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '900', letterSpacing: -0.4, color: '#111827' },
  closeBtn: { padding: 8, backgroundColor: '#EFF6FF', borderRadius: 20 },
  card: { backgroundColor: '#FFFFFF', marginBottom: 16, borderRadius: 16, borderWidth: 1, borderColor: '#F3F4F6', overflow: 'hidden', elevation: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  headText: { flex: 1, marginLeft: 12 },
  author: { fontSize: 14, fontWeight: '700', color: '#111827' },
  time: { fontSize: 12, color: '#9CA3AF' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { backgroundColor: '#EAE5F8', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { color: '#6041B8', fontSize: 12, fontWeight: '600' },
  body: { paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 },
  content: { fontSize: 14, lineHeight: 21, color: '#1F2937' },
  image: { width: '100%', height: 192, backgroundColor: '#F3F4F6' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  muted: { color: '#9A97A6', fontSize: 13 },
  mapBox: { height: 176, width: '100%', backgroundColor: '#F9FAFB', borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  hud: { position: 'absolute', bottom: 12, left: 12, maxWidth: '70%', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, flexDirection: 'row', alignItems: 'center' },
  hudDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981', marginRight: 8 },
  hudText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', flexShrink: 1 },
});
