/**
 * Voice and video buttons for a chat header.
 *
 *   <CallButtons conversationId={chat.id} memberUserIds={chat.memberIds} />
 */
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import type { CallKind } from '../protocol';
import { errorText } from '../signaling';
import { useCalls, useManagerState } from '../ui/CallProvider';
import { Icon, theme } from '../ui/kit';

export function CallButtons({
  conversationId,
  memberUserIds,
  color = theme.text,
}: {
  conversationId: string;
  /** Everyone in the chat. You are filtered out. */
  memberUserIds: string[];
  color?: string;
}) {
  const { manager } = useCalls();
  const state = useManagerState(manager);
  const [starting, setStarting] = useState<CallKind | null>(null);
  const others = memberUserIds.filter((u) => u !== manager.session.userId);
  const inCall = !!state.engine && state.engine.state.status !== 'ended';

  const start = async (kind: CallKind) => {
    if (starting || inCall || others.length === 0) return;
    setStarting(kind);
    try {
      await manager.startCall(conversationId, kind, others.slice(0, 7));
    } catch (e: any) {
      Alert.alert("Couldn't start the call", errorText(e?.code ?? e?.message ?? ''));
    } finally {
      setStarting(null);
    }
  };

  const Btn = ({ kind, icon, label }: { kind: CallKind; icon: string; label: string }) => (
    <Pressable
      onPress={() => start(kind)}
      disabled={!!starting || inCall || others.length === 0}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [st.btn, { opacity: inCall ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      {starting === kind ? <ActivityIndicator color={color} /> : <Icon name={icon} color={color} />}
    </Pressable>
  );

  return (
    <View style={st.row}>
      <Btn kind="voice" icon="phone" label="Voice call" />
      <Btn kind="video" icon="video" label="Video call" />
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  btn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
