import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MoreItem } from '../moreMenu';
import { Icon, Sheet, theme } from './kit';

export function MoreSheet({
  visible,
  items,
  onClose,
  onSelect,
}: {
  visible: boolean;
  items: MoreItem[];
  onClose: () => void;
  onSelect: (item: MoreItem) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={st.grid}>
        {items.map((item) => {
          const color = item.destructive ? theme.danger : item.active ? theme.bg : theme.text;
          return (
            <Pressable
              key={item.id}
              onPress={() => onSelect(item)}
              disabled={item.disabled}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityHint={item.hint}
              accessibilityState={{ disabled: !!item.disabled, selected: !!item.active }}
              style={({ pressed }) => [
                st.cell,
                item.active && { backgroundColor: theme.text },
                { opacity: item.disabled ? 0.4 : pressed ? 0.75 : 1 },
              ]}
            >
              <Icon name={item.icon} size={24} color={color} />
              <Text style={[st.label, { color }]} numberOfLines={2}>
                {item.label}
              </Text>
              {item.hint && item.disabled ? (
                <Text style={st.hint} numberOfLines={2}>
                  {item.hint}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: {
    width: '31%',
    flexGrow: 1,
    minHeight: 92,
    borderRadius: 16,
    backgroundColor: theme.surfaceHi,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    gap: 8,
  },
  label: { fontSize: 13, fontWeight: '500', textAlign: 'center' },
  hint: { color: theme.textDim, fontSize: 11, textAlign: 'center' },
});
