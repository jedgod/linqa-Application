// Simple list rows used by the settings-style screens.

import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { COLORS as C } from '../../constants/theme';

export function Section({ title, footer, children }: {
  title?: string;
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      {title && (
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
      )}
      <View style={styles.card}>{children}</View>
      {footer && <Text style={styles.footer}>{footer}</Text>}
    </View>
  );
}

/** One choice in a single-select list (radio behavior). */
export function OptionRow({ label, selected, onPress, disabled, last }: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      android_ripple={{ color: C.pressed }}
      style={({ pressed }) => [
        styles.row,
        !last && styles.rowBorder,
        pressed && { backgroundColor: C.pressed },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      {selected && <Check size={20} color={C.accent} strokeWidth={2.2} />}
    </Pressable>
  );
}

export function SwitchRow({ label, value, onValueChange, disabled, description }: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  description?: string;
}) {
  return (
    <View style={[styles.row, { minHeight: description ? 64 : 52 }]}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {description && <Text style={styles.rowDesc}>{description}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: C.accent, false: '#C9CFDC' }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  sectionTitle: {
    paddingHorizontal: 4,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: C.muted,
  },
  card: { backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden' },
  footer: { paddingHorizontal: 4, fontSize: 13, lineHeight: 18, color: C.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: C.divider },
  rowLabel: { fontSize: 16, color: C.text },
  rowDesc: { fontSize: 13, color: C.muted, marginTop: 2 },
});
