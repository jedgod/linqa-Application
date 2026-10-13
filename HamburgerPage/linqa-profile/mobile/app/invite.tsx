// Invite Friends: share a link that points people to your @username.

import React from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { AtSign, Share2, ShieldCheck } from 'lucide-react-native';
import { COLORS as C } from '../constants/theme';
import { useProfile } from '../hooks/useProfile';

// TODO: set EXPO_PUBLIC_INVITE_URL in your .env to the page that opens or downloads Linqa,
// for example https://your-domain/invite. The @username is appended when the user has one.
const INVITE_BASE = (process.env.EXPO_PUBLIC_INVITE_URL ?? 'https://example.com/linqa').replace(/\/+$/, '');

export default function InviteScreen() {
  const router = useRouter();
  const { profile } = useProfile();
  const username = profile?.username ?? null;

  const link = username ? `${INVITE_BASE}/@${username}` : INVITE_BASE;
  const message = username
    ? `Let's talk on Linqa, it's end-to-end encrypted. Find me at @${username}: ${link}`
    : `Let's talk on Linqa, it's end-to-end encrypted: ${link}`;

  const share = async () => {
    try {
      // Message only: the link is already inside it, and passing `url` too
      // makes some iOS share targets paste the link twice.
      await Share.share({ message, title: 'Join me on Linqa' });
    } catch {
      // User closed the share sheet or sharing failed; nothing to do.
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Invite Friends' }} />

      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <ShieldCheck size={32} color={C.headerText} strokeWidth={1.8} />
        </View>
        <Text style={styles.heroTitle}>Bring your people to Linqa</Text>
        <Text style={styles.heroText}>
          Every chat and call is end-to-end encrypted, so only the people in the conversation can read it.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Your invite message</Text>
        <Text style={styles.preview} selectable>
          {message}
        </Text>
      </View>

      <Pressable
        onPress={() => void share()}
        accessibilityRole="button"
        style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
      >
        <Share2 size={20} color="#FFFFFF" strokeWidth={2} />
        <Text style={styles.primaryText}>Share invite</Text>
      </Pressable>

      {!username && (
        <Pressable
          onPress={() => router.push('/account/manage' as Href)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.secondary, pressed && { backgroundColor: C.pressed }]}
        >
          <AtSign size={20} color={C.accent} strokeWidth={2} />
          <Text style={styles.secondaryText}>Add a username so friends can find you</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  content: { padding: 16, gap: 16 },
  hero: {
    backgroundColor: C.headerBg,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { color: C.headerText, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  heroText: { color: C.headerSubtext, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  card: { backgroundColor: C.surface, borderRadius: 16, padding: 16, gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted },
  preview: { fontSize: 15, lineHeight: 21, color: C.text },
  primary: {
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  secondary: {
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: C.surface,
    alignItems: 'center',
  },
  secondaryText: { flex: 1, color: C.accent, fontSize: 15, fontWeight: '600' },
});
