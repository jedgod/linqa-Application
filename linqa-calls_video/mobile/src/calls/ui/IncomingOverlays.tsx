import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorText } from '../signaling';
import { useCalls, useManagerState } from './CallProvider';
import { Button, Icon, theme } from './kit';

/**
 * In-app ring and "Take call here?" prompt.
 * For calls while the app is backgrounded, hook RingNotifier pushes into
 * CallKit (iOS) / ConnectionService (Android) and call manager.answer().
 */
export function IncomingOverlays() {
  const { manager, people } = useCalls();
  const s = useManagerState(manager);
  const err = s.error ? errorText(s.error) : null;

  if (s.incomingHandoff) {
    const h = s.incomingHandoff;
    return (
      <View style={st.card} accessibilityViewIsModal accessibilityLiveRegion="assertive">
        <Icon name="smartphone" size={28} />
        <Text style={st.title}>Take call here?</Text>
        <Text style={st.body}>
          Your {h.kind} call on {h.fromDeviceName} will move to this device.
        </Text>
        {err ? <Text style={st.err}>{err}</Text> : null}
        <View style={st.row}>
          <Button label="Not now" kind="ghost" onPress={() => manager.declineHandoff()} style={{ flex: 1 }} />
          <Button label="Take call" busy={s.busy} onPress={() => manager.acceptHandoff().catch(() => {})} style={{ flex: 1 }} />
        </View>
      </View>
    );
  }

  if (s.incoming && !s.engine) {
    const r = s.incoming;
    return (
      <View style={st.card} accessibilityViewIsModal accessibilityLiveRegion="assertive">
        <Icon name={r.kind === 'video' ? 'video' : 'phone'} size={28} />
        <Text style={st.title}>{people.displayName(r.fromUserId)}</Text>
        <Text style={st.body}>Linqa {r.kind} call</Text>
        {err ? <Text style={st.err}>{err}</Text> : null}
        <View style={st.row}>
          <Button label="Decline" kind="danger" onPress={() => manager.decline()} style={{ flex: 1 }} />
          <Button label="Answer" busy={s.busy} onPress={() => manager.answer().catch(() => {})} style={{ flex: 1 }} />
        </View>
      </View>
    );
  }
  return null;
}

const st = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 56,
    zIndex: 200,
    backgroundColor: theme.surface,
    borderRadius: 20,
    padding: 18,
    alignItems: 'center',
    gap: 6,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  title: { color: theme.text, fontSize: 18, fontWeight: '600' },
  body: { color: theme.textDim, fontSize: 15, textAlign: 'center', marginBottom: 8 },
  err: { color: theme.danger, marginBottom: 6 },
  row: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
});
