// Wrap your whole app with <AppLockGate> in app/_layout.tsx.
// When App Lock is on, it:
//  - locks on cold start,
//  - locks again after the app was in the background longer than the chosen timeout,
//  - covers the screen while backgrounded so chats don't show in the app switcher.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Lock } from 'lucide-react-native';
import { COLORS as C } from '../../constants/theme';
import { getSettings, loadSettings, useLocalSettings } from '../../lib/localSettings';

export function AppLockGate({ children }: { children: React.ReactNode }) {
  const { settings } = useLocalSettings();
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [covered, setCovered] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  const authenticating = useRef(false);

  const unlock = useCallback(async () => {
    if (authenticating.current) return;
    authenticating.current = true;
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Linqa',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (res.success) setLocked(false);
    } finally {
      authenticating.current = false;
    }
  }, []);

  // Cold start: read settings, lock if enabled.
  useEffect(() => {
    (async () => {
      await loadSettings();
      if (getSettings().appLockEnabled) setLocked(true);
      setReady(true);
    })();
  }, []);

  // Turning App Lock off elsewhere unlocks immediately.
  useEffect(() => {
    if (!settings.appLockEnabled) setLocked(false);
  }, [settings.appLockEnabled]);

  // Background / foreground handling.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      const { appLockEnabled, appLockTimeoutSec } = getSettings();
      if (!appLockEnabled) {
        setCovered(false);
        return;
      }
      if (next === 'inactive') {
        // iOS: app switcher or notification center. Also fires during Face ID prompts,
        // so only cover the screen here; the lock timer starts on 'background'.
        if (!authenticating.current) setCovered(true);
        return;
      }
      if (next === 'background') {
        setCovered(true);
        if (backgroundedAt.current === null) backgroundedAt.current = Date.now();
        return;
      }
      if (next === 'active') {
        setCovered(false);
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (since !== null && (Date.now() - since) / 1000 >= appLockTimeoutSec) setLocked(true);
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  // Prompt automatically whenever the app becomes locked while in the foreground.
  useEffect(() => {
    if (locked && AppState.currentState === 'active') void unlock();
  }, [locked, unlock]);

  if (!ready) return <View style={styles.blank} />;

  return (
    <View style={{ flex: 1 }}>
      {/* Keep the app mounted underneath so state survives a lock. */}
      <View
        style={{ flex: 1 }}
        importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={locked}
      >
        {children}
      </View>

      {(locked || covered) && (
        <View style={[StyleSheet.absoluteFill, styles.lock]} accessibilityViewIsModal>
          <View style={styles.iconWrap}>
            <Lock size={36} color={C.headerText} strokeWidth={1.8} />
          </View>
          <Text style={styles.title}>Linqa is locked</Text>
          {locked && (
            <Pressable
              onPress={() => void unlock()}
              accessibilityRole="button"
              style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.btnText}>Unlock</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: C.headerBg },
  lock: {
    backgroundColor: C.headerBg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    padding: 32,
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: C.headerText, fontSize: 20, fontWeight: '700' },
  btn: {
    minWidth: 180,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: C.avatarBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
