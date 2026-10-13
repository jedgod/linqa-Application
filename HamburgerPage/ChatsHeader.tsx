// Top bar of the Chats page with the hamburger (≡) button.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Menu, SquarePen } from 'lucide-react-native';
import { DRAWER_COLORS as C } from './drawerItems';

type Props = {
  onMenuPress: () => void;
  onComposePress?: () => void;
};

export function ChatsHeader({ onMenuPress, onComposePress }: Props) {
  return (
    <View style={styles.bar}>
      <Pressable
        onPress={onMenuPress}
        accessibilityRole="button"
        accessibilityLabel="Open menu"
        hitSlop={6}
        style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: C.pressed }]}
      >
        <Menu size={24} color={C.text} strokeWidth={1.8} />
      </Pressable>

      <Text style={styles.title} accessibilityRole="header">
        Chats
      </Text>

      {onComposePress && (
        <Pressable
          onPress={onComposePress}
          accessibilityRole="button"
          accessibilityLabel="New chat"
          hitSlop={6}
          style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: C.pressed }]}
        >
          <SquarePen size={22} color={C.text} strokeWidth={1.8} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 8,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 26, fontWeight: '700', letterSpacing: -0.5, color: C.text },
});
