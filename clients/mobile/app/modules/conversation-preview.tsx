import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ConversationScreen } from "../../components/conversation/ConversationScreen";
import { DEFAULT_PREFS, type ConversationPrefs } from "../../services/conversation-engine";
import { PREVIEW_PEER, PREVIEW_SELF, createPreviewConversation } from "../../services/conversation-preview";

/**
 * Design preview of the conversation page with made-up sample messages (development builds only).
 * Nothing here is real: no server, no encryption, no one is messaged. Real conversations open from Chats.
 */
export default function ConversationPreview() {
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name?: string }>();
  const { service, gate } = useMemo(() => createPreviewConversation(), []);
  const [prefs, setPrefs] = useState<ConversationPrefs>(DEFAULT_PREFS);
  const [pinned, setPinned] = useState(false);
  const [disappear, setDisappear] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<{ at: string | null } | null>(null);
  // Sample safety number, to look at the Verify page layout. It is NOT derived from any keys.
  const sample = ["48201", "93357", "10846", "72519", "66038", "25971", "80412", "39765", "57120", "14893", "61307", "09548"];

  if (!__DEV__) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Text>Not available.</Text></View>;
  return (
    <ConversationScreen
      conversationId="preview"
      selfId={PREVIEW_SELF}
      peer={{ id: PREVIEW_PEER, displayName: name?.slice(0, 60) || "Jerry Mensah" }}
      service={service}
      gate={gate}
      newId={() => Crypto.randomUUID()}
      prefs={prefs}
      onPrefsChange={setPrefs}
      blocked={blocked}
      onBlock={() => setBlocked({ at: new Date().toISOString() })}
      onUnblock={() => setBlocked(null)}
      pinned={pinned}
      disappearAfterSeconds={disappear}
      onPinnedChange={setPinned}
      onDisappearChange={setDisappear}
      safetyNumber={sample}
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/chats"))}
      notice="Design preview with sample messages. Nothing is sent or encrypted."
    />
  );
}
