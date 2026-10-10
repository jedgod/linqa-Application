import * as SecureStore from "expo-secure-store";
import { DEFAULT_PREFS, parsePrefs, type ConversationPrefs } from "./conversation-engine";

/**
 * Appearance and "quiet" for one conversation, kept on this device only. No message text or keys are
 * stored here. Quiet is a per-conversation switch (not a timed schedule); the notification code reads it.
 */
// SecureStore keys may only contain letters, digits, ".", "-" and "_".
const keyFor = (conversationId: string) => `linqa.conversation.prefs.${conversationId.replace(/[^A-Za-z0-9-]/g, "")}`;

export async function loadPrefs(conversationId: string): Promise<ConversationPrefs> {
  try { return parsePrefs(await SecureStore.getItemAsync(keyFor(conversationId))); } catch { return DEFAULT_PREFS; }
}

/** Resolves true only if the preference was really stored. */
export async function savePrefs(conversationId: string, prefs: ConversationPrefs): Promise<boolean> {
  try { await SecureStore.setItemAsync(keyFor(conversationId), JSON.stringify(prefs)); return true; } catch { return false; }
}
