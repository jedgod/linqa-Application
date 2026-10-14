import React, { useEffect } from 'react';
import { StyleSheet, Text, Vibration, View } from 'react-native';
import { errorText } from '../signaling';
import { useCalls, useManagerState } from './CallProvider';
import { PersonAvatar } from '../../../components/account/PersonAvatar';
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

  // Ring for attention while a call is waiting to be answered here: the phone's ringtone plus a repeating vibration, so a phone set to
  // silent still gets the person's attention. Both stop as soon as the call is answered, declined or ends.
  const ringing = Boolean(s.incoming && !s.engine && !manager.systemRingUi) || Boolean(s.incomingHandoff);
  useEffect(() => {
    if (!ringing) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    Vibration.vibrate([0, 900, 700], true);
    void import('react-native-incall-manager').then((module) => {
      const incall = (module as { default?: { startRingtone?: (...a: unknown[]) => void; stopRingtone?: () => void } }).default;
      if (cancelled || !incall) return;
      try { incall.startRingtone?.('_DEFAULT_', [0, 900, 700], 'default', 30); stop = () => incall.stopRingtone?.(); } catch { /* vibration still runs */ }
    }).catch(() => undefined);
    return () => { cancelled = true; Vibration.cancel(); try { stop?.(); } catch { /* already stopped */ } };
  }, [ringing]);

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

  if (s.incoming && !s.engine && !manager.systemRingUi) {
    const r = s.incoming;
    return (
      <View style={st.card} accessibilityViewIsModal accessibilityLiveRegion="assertive">
        <PersonAvatar name={people.displayName(r.fromUserId)} userId={r.fromUserId} size={72} />
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
