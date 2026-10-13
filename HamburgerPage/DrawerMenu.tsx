// Contents of the Linqa side drawer: profile header, menu sections, log out.

import React from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { ChevronRight, LogOut, X } from 'lucide-react-native';
import { DRAWER_COLORS as C, DRAWER_SECTIONS, type DrawerItem } from './drawerItems';

export type DrawerUser = {
  name: string;
  username: string;
  avatarUrl?: string | null;
};

type Props = {
  user: DrawerUser;
  onClose: () => void;
  onSelect: (item: DrawerItem) => void;
  onProfilePress: () => void;
  onLogout: () => void | Promise<void>;
};

export function DrawerMenu({ user, onClose, onSelect, onProfilePress, onLogout }: Props) {
  const insets = useSafeAreaInsets();
  const version = Constants.expoConfig?.version ?? '';

  const confirmLogout = () => {
    Alert.alert('Log out of Linqa?', 'You will need to sign in again on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => void onLogout() },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* Profile header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerTop}>
          <Avatar user={user} />
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            hitSlop={8}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
          >
            <X size={22} color={C.headerText} strokeWidth={1.8} />
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
              @{user.username} · View profile
            </Text>
          </View>
          <ChevronRight size={18} color={C.headerText} strokeWidth={1.8} />
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
                Icon={item.icon}
                onPress={() => onSelect(item)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <MenuRow label="Log Out" Icon={LogOut} onPress={confirmLogout} color={C.danger} />
        <Text style={styles.version}>
          {version ? `Linqa v${version} · ` : 'Linqa · '}End-to-end encrypted
        </Text>
      </View>
    </View>
  );
}

function Avatar({ user }: { user: DrawerUser }) {
  if (user.avatarUrl) {
    return <Image source={{ uri: user.avatarUrl }} style={styles.avatar} accessibilityIgnoresInvertColors />;
  }
  const initial = (user.name.trim()[0] ?? '?').toUpperCase();
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarInitial}>{initial}</Text>
    </View>
  );
}

function MenuRow({
  label,
  Icon,
  onPress,
  color = C.text,
}: {
  label: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
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
      <Icon size={22} color={color} strokeWidth={1.8} />
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
  avatar: { width: 60, height: 60, borderRadius: 30 },
  avatarFallback: { backgroundColor: C.avatarBg, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: C.headerText, fontSize: 24, fontWeight: '700' },
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
  footer: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: C.divider, paddingTop: 6 },
  version: { paddingHorizontal: 20, marginTop: 2, fontSize: 12, color: C.muted },
});
