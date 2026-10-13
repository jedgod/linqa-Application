// Device-local settings for Disappearing Messages and App Lock.
// Stored with AsyncStorage on this device only; nothing is sent to the server.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

const KEY = 'linqa.settings.v1';

export type LocalSettings = {
  /** Default timer for NEW chats, in seconds. 0 = off. */
  disappearingDefaultSec: number;
  appLockEnabled: boolean;
  /** How long the app can be in the background before it locks. 0 = immediately. */
  appLockTimeoutSec: number;
};

const DEFAULTS: LocalSettings = {
  disappearingDefaultSec: 0,
  appLockEnabled: false,
  appLockTimeoutSec: 60,
};

let settings: LocalSettings = DEFAULTS;
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function loadSettings(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) settings = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<LocalSettings>) };
      } catch {
        settings = DEFAULTS;
      }
      loaded = true;
      emit();
    })();
  }
  return loading;
}

export function getSettings(): LocalSettings {
  return settings;
}

export async function updateSettings(patch: Partial<LocalSettings>) {
  settings = { ...settings, ...patch };
  emit();
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}

/** Default disappearing timer to attach to new chats. Read this when a chat is created. */
export async function getDisappearingDefaultSec(): Promise<number> {
  await loadSettings();
  return settings.disappearingDefaultSec;
}

export function useLocalSettings() {
  const snapshot = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => settings,
  );
  useEffect(() => {
    void loadSettings();
  }, []);
  return { settings: snapshot, loaded, update: updateSettings };
}
