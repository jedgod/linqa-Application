// Saved Messages screen.

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { Bookmark, Search } from 'lucide-react-native';
import { COLORS as C } from '../constants/theme';
import { useSavedMessages, type SavedMessage } from '../lib/savedMessages';

function formatWhen(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export default function SavedMessagesScreen() {
  const router = useRouter();
  const { items, loaded, remove } = useSavedMessages();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (m) =>
        m.text.toLowerCase().includes(q) ||
        m.chatName.toLowerCase().includes(q) ||
        m.senderName.toLowerCase().includes(q),
    );
  }, [items, query]);

  // TODO: change '/chat/' to your chat route if it is named differently.
  const openChat = (m: SavedMessage) => router.push(`/chat/${m.chatId}` as Href);

  const onLongPress = (m: SavedMessage) => {
    Alert.alert('Saved message', undefined, [
      { text: 'Go to chat', onPress: () => openChat(m) },
      { text: 'Remove from Saved', style: 'destructive', onPress: () => void remove(m.messageId) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Saved Messages' }} />

      {items.length > 0 && (
        <View style={styles.searchWrap}>
          <Search size={18} color={C.muted} strokeWidth={1.8} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search saved messages"
            placeholderTextColor={C.muted}
            accessibilityLabel="Search saved messages"
            style={styles.search}
            autoCorrect={false}
          />
        </View>
      )}

      {!loaded ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={C.accent} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(m) => m.messageId}
          contentContainerStyle={filtered.length ? styles.list : styles.emptyList}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            items.length === 0 ? (
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Bookmark size={30} color={C.accent} strokeWidth={1.8} />
                </View>
                <Text style={styles.emptyTitle}>No saved messages yet</Text>
                <Text style={styles.emptyText}>
                  Press and hold a message in any chat, then tap Save. Saved messages stay on this device only.
                </Text>
              </View>
            ) : (
              <Text style={styles.emptyText}>No saved messages match “{query.trim()}”.</Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openChat(item)}
              onLongPress={() => onLongPress(item)}
              accessibilityRole="button"
              accessibilityHint="Opens the chat. Press and hold for more options."
              style={({ pressed }) => [styles.card, pressed && { backgroundColor: C.pressed }]}
            >
              <View style={styles.cardTop}>
                <Text style={styles.chatName} numberOfLines={1}>
                  {item.chatName}
                </Text>
                <Text style={styles.time}>{formatWhen(item.sentAt)}</Text>
              </View>
              <Text style={styles.sender} numberOfLines={1}>
                {item.senderName}
              </Text>
              <Text style={styles.text} numberOfLines={6}>
                {item.text}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    margin: 16,
    marginBottom: 4,
    paddingHorizontal: 14,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: C.surface,
  },
  search: { flex: 1, fontSize: 15, color: C.text, paddingVertical: 10 },
  list: { padding: 16 },
  emptyList: { flexGrow: 1, padding: 16, justifyContent: 'center' },
  card: { backgroundColor: C.surface, borderRadius: 16, padding: 16, gap: 4 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  chatName: { flex: 1, fontSize: 15, fontWeight: '700', color: C.text },
  time: { fontSize: 12, color: C.muted },
  sender: { fontSize: 13, color: C.muted },
  text: { fontSize: 15, lineHeight: 21, color: C.text, marginTop: 4 },
  empty: { alignItems: 'center', gap: 10, paddingHorizontal: 24 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E7EDFD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  emptyText: { fontSize: 14, lineHeight: 20, color: C.muted, textAlign: 'center' },
});
