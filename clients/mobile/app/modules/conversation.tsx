import { useLocalSearchParams } from "expo-router";
import { ConversationContainer } from "../../components/conversation/ConversationContainer";

/** Full-screen conversation route. The two-pane tablet Chats layout embeds `ConversationContainer` directly. */
export default function ConversationRoute() {
  const params = useLocalSearchParams<{ conversationId?: string; name?: string; peerId?: string; aiShare?: string }>();
  return <ConversationContainer {...params} />;
}
