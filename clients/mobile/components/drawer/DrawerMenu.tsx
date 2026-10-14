// Contents of the Linqa side drawer: profile header, menu sections, log out.

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../account/Avatar';
import { DRAWER_COLORS as C, DRAWER_SECTIONS, DRAWER_VERSION, type DrawerIcon, type DrawerItem } from './drawerItems';

export type DrawerUser = {
  name: string;
  /** Shown as @username when present. */
  username?: string | null;
  avatarUrl?: string | null;
  /** Sent with the avatar request; avatars need the account's access token. */
  avatarHeaders?: Record<string, string>;
};

type Props = {
  user: DrawerUser;
  onClose: () => void;
  onSelect: (item: DrawerItem) => void;
  onProfilePress: () => void;
};

export function DrawerMenu({ user, onClose, onSelect, onProfilePress }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      {/* Profile header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={onProfilePress} accessibilityRole="button" accessibilityLabel="Edit profile photo">
            <Avatar name={user.name} uri={user.avatarUrl} headers={user.avatarHeaders} size={60} />
          </Pressable>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            hitSlop={8}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="close-outline" size={24} color={C.headerText} />
          </Pressable>
        </View>

        <Pressable
          onPress={onProfilePress}
          accessibilityRole="button"
          accessibilityLabel={`${user.name}, view profile`}
          style={({ pressed }) => [styles.profileRow, pressed && { opacity: 0.8 }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>
              {user.name}
            </Text>
            <Text style={styles.username} numberOfLines={1}>
              {user.username ? `@${user.username} · ` : ''}View profile
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.headerText} />
        </Pressable>
      </View>

      {/* Menu sections */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 6 }}>
        {DRAWER_SECTIONS.map((section, i) => (
          <View key={section.title ?? `section-${i}`}>
            {section.divider && <View style={styles.divider} />}
            {section.title && (
              <Text style={styles.sectionTitle} accessibilityRole="header">
                {section.title}
              </Text>
            )}
            {section.items.map((item) => (
              <MenuRow
                key={item.key}
                label={item.label}
                icon={item.icon}
                onPress={() => onSelect(item)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: 12 }]}>
        <Text style={styles.version}>Linqa v{DRAWER_VERSION}</Text>
        <Text style={styles.encrypted}>End-to-end encrypted</Text>
      </View>
    </View>
  );
}

function MenuRow({
  label,
  icon,
  onPress,
  color = C.text,
}: {
  label: string;
  icon: DrawerIcon;
  onPress: () => void;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: C.pressed }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: C.pressed }]}
    >
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.rowLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    backgroundColor: C.headerBg,
    paddingHorizontal: 20,
    paddingBottom: 18,
    borderTopRightRadius: 24,
    gap: 14,
  },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.closeBtnBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  name: { color: C.headerText, fontSize: 17, fontWeight: '700' },
  username: { color: C.headerSubtext, fontSize: 13, marginTop: 2 },
  sectionTitle: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: C.muted,
  },
  divider: { height: StyleSheet.hairlineWidth * 2, backgroundColor: C.divider, marginHorizontal: 20, marginVertical: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minHeight: 48,
    paddingHorizontal: 20,
  },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: C.divider, paddingTop: 12 },
  version: { paddingHorizontal: 20, fontSize: 12, color: C.muted },
  encrypted: { paddingHorizontal: 20, marginTop: 2, fontSize: 12, color: C.muted },
});
