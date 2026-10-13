/**
 * Small shared pieces for the call UI: theme, icon, bottom sheet, confirm.
 * Swap `theme` values for Linqa's tokens.
 */
import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';

export const theme = {
  bg: '#0E0F12',
  surface: '#1A1C21',
  surfaceHi: '#25282F',
  line: '#2E3139',
  text: '#F3F4F6',
  textDim: '#A2A7B3',
  accent: '#5AA9FF',
  accentText: '#0B1220',
  danger: '#FF5A5F',
  warn: '#FFD60A',
  ok: '#4CD3A5',
  radius: 16,
};

const MCI_NAMES: Record<string, string> = { hand: 'hand-back-right-outline' };

export function Icon({ name, size = 22, color = theme.text }: { name: string; size?: number; color?: string }) {
  if (MCI_NAMES[name]) return <MCI name={MCI_NAMES[name] as never} size={size} color={color} />;
  return <Feather name={name as never} size={size} color={color} />;
}

export function Sheet({
  visible,
  onClose,
  title,
  children,
  style,
  scrollable = true,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  style?: ViewStyle;
  scrollable?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const maxHeight = Math.max(120, height - insets.top - insets.bottom - 24);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', paddingTop: insets.top + 12, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={[StyleSheet.absoluteFill, k.scrim]} onPress={onClose} accessibilityLabel="Close menu" />
        <View style={[k.sheet, style, { maxHeight, flexShrink: 1 }]} accessibilityViewIsModal>
          <View style={k.grabber} />
          {title ? (
            <Text style={k.sheetTitle} accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {scrollable ? <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>{children}</ScrollView> : children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface ConfirmProps {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The single "ask once" before anything new is sent to the call. */
export function ConfirmDialog(p: ConfirmProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={p.visible} transparent animationType="fade" onRequestClose={p.onCancel}>
      <View style={k.center}>
        <View style={[k.dialog, { maxHeight: height - insets.top - insets.bottom - 48 }]} accessibilityViewIsModal>
          <Text style={k.dialogTitle}>{p.title}</Text>
          <ScrollView style={{ flexGrow: 0, flexShrink: 1 }}><Text style={k.dialogBody}>{p.body}</Text></ScrollView>
          <View style={k.row}>
            <Button label="Cancel" kind="ghost" onPress={p.onCancel} style={{ flex: 1 }} />
            <Button
              label={p.confirmLabel}
              kind={p.destructive ? 'danger' : 'primary'}
              onPress={p.onConfirm}
              busy={p.busy}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const bg = kind === 'primary' ? theme.accent : kind === 'danger' ? theme.danger : theme.surfaceHi;
  const fg = kind === 'primary' ? theme.accentText : theme.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={({ pressed }) => [k.btn, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[k.btnText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, active]);
  return now;
}

export const k = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
    maxHeight: '85%',
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.line, marginBottom: 12 },
  sheetTitle: { color: theme.text, fontSize: 18, fontWeight: '600', marginBottom: 12 },
  center: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 380, backgroundColor: theme.surface, borderRadius: 20, padding: 20 },
  dialogTitle: { color: theme.text, fontSize: 18, fontWeight: '600', marginBottom: 8 },
  dialogBody: { color: theme.textDim, fontSize: 15, lineHeight: 21, marginBottom: 20 },
  row: { flexDirection: 'row', gap: 10 },
  btn: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnText: { fontSize: 16, fontWeight: '600' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line,
  },
  dim: { color: theme.textDim, fontSize: 14 },
  body: { color: theme.text, fontSize: 16 },
});
