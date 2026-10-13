// Saved Messages, kept on this device only (never sent to the server).
//
// Call saveMessage(...) from your chat screen's long-press menu ("Save"),
// and isSaved(...) to show a bookmark state on a bubble.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

const KEY = 'linqa.saved.v1';

export type SavedMessage = {
  /** The original message id, so the same message is only saved once. */
  messageId: string;
  chatId: string;
  chatName: string;
  senderName: string;
  /** Plain text of the message (already decrypted on this device). */
  text: string;
  /** When the original message was sent (ms since epoch). */
  sentAt: number;
  /** When it was saved (ms since epoch). */
  savedAt: number;
};

let items: SavedMessage[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

async function persist() {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

export function loadSaved(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        items = raw ? (JSON.parse(raw) as SavedMessage[]) : [];
      } catch {
        items = [];
      }
      loaded = true;
      emit();
    })();
  }
  return loading;
}

export async function saveMessage(msg: Omit<SavedMessage, 'savedAt'>) {
  await loadSaved();
  items = [{ ...msg, savedAt: Date.now() }, ...items.filter((m) => m.messageId !== msg.messageId)];
  emit();
  await persist();
}

export async function removeSaved(messageId: string) {
  await loadSaved();
  items = items.filter((m) => m.messageId !== messageId);
  emit();
  await persist();
}

export function isSaved(messageId: string): boolean {
  return items.some((m) => m.messageId === messageId);
}

/** Wipe everything, for example on sign-out or account removal. */
export async function clearSaved() {
  items = [];
  emit();
  await AsyncStorage.removeItem(KEY);
}

export function useSavedMessages() {
  const snapshot = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => items,
  );
  useEffect(() => {
    void loadSaved();
  }, []);
  return { items: snapshot, loaded, remove: removeSaved };
}
