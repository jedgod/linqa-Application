import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
  const { width, fontScale } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(width - 32);
  const columns = contentWidth < 308 || fontScale > 1.3 ? 2 : 3;
  const cellWidth = Math.max(1, (contentWidth - (columns - 1) * 10) / columns);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={st.grid} onLayout={event => setContentWidth(event.nativeEvent.layout.width)}>
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
                { width: cellWidth },
                item.active && { backgroundColor: theme.text },
                { opacity: item.disabled ? 0.4 : pressed ? 0.75 : 1 },
              ]}
            >
              <Icon name={item.icon} size={24} color={color} />
              <Text style={[st.label, { color }]}>
                {item.label}
              </Text>
              {item.hint && item.disabled ? (
                <Text style={st.hint}>
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
    flexGrow: 0,
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
