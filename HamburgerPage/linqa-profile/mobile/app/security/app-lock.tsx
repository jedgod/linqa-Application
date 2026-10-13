// App Lock: require Face ID / fingerprint / device passcode to open Linqa.
// The actual locking happens in <AppLockGate> (components/security/AppLockGate.tsx).

import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { Stack } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { COLORS } from '../../constants/theme';
import { OptionRow, Section, SwitchRow } from '../../components/ui/Rows';
import { useLocalSettings } from '../../lib/localSettings';

const TIMEOUTS: { label: string; seconds: number }[] = [
  { label: 'Immediately', seconds: 0 },
  { label: 'After 1 minute', seconds: 60 },
  { label: 'After 5 minutes', seconds: 5 * 60 },
  { label: 'After 30 minutes', seconds: 30 * 60 },
  { label: 'After 1 hour', seconds: 60 * 60 },
];

type DeviceSupport = 'checking' | 'ready' | 'no-hardware' | 'not-enrolled';

export default function AppLockScreen() {
  const { settings, loaded, update } = useLocalSettings();
  const [support, setSupport] = useState<DeviceSupport>('checking');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (level !== LocalAuthentication.SecurityLevel.NONE) setSupport('ready');
      else setSupport(hasHardware ? 'not-enrolled' : 'no-hardware');
    })();
  }, []);

  const toggle = async (next: boolean) => {
    if (busy) return;
    if (next && support !== 'ready') {
      Alert.alert(
        'Set up a screen lock first',
        'Add a fingerprint, Face ID or a device passcode in your phone settings, then turn on App Lock.',
      );
      return;
    }
    // Confirm it is really the owner before changing the setting either way.
    setBusy(true);
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: next ? 'Turn on App Lock' : 'Turn off App Lock',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (res.success) await update({ appLockEnabled: next });
    } finally {
      setBusy(false);
    }
  };

  const supportNote =
    support === 'no-hardware'
      ? 'This device has no biometric sensor. App Lock will use your device passcode once one is set.'
      : support === 'not-enrolled'
        ? 'No screen lock is set up on this device. Add one in your phone settings to use App Lock.'
        : undefined;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'App Lock' }} />

      <Section footer="When on, Linqa asks for your face, fingerprint or device passcode before it opens. Incoming call and message notifications still appear.">
        <SwitchRow
          label="Require unlock"
          value={settings.appLockEnabled}
          onValueChange={(v) => void toggle(v)}
          disabled={!loaded || busy || support === 'checking'}
        />
      </Section>

      {supportNote && <Text style={styles.warn}>{supportNote}</Text>}

      {settings.appLockEnabled && (
        <Section title="Lock Linqa">
          {TIMEOUTS.map((t, i) => (
            <OptionRow
              key={t.seconds}
              label={t.label}
              selected={settings.appLockTimeoutSec === t.seconds}
              onPress={() => void update({ appLockTimeoutSec: t.seconds })}
              last={i === TIMEOUTS.length - 1}
            />
          ))}
        </Section>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, gap: 20 },
  warn: { paddingHorizontal: 4, fontSize: 13, lineHeight: 18, color: COLORS.danger },
});
