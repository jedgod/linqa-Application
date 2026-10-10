import React, { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ConversationHeader } from "./ConversationHeader";
import { ComposerArea } from "./ComposerArea";
import { MessageBubble } from "./MessageBubble";
import { useConversation } from "./useConversation";
import { useConversationTheme, space, type } from "./theme";
import { ConversationPeer, ConversationServiceLike, DisplayMessage, MessagingGateLike } from "./types";

const GROUP_GAP_MS = 5 * 60 * 1000;

export interface ConversationScreenProps {
  conversationId: string;
  selfId: string;
  peer: ConversationPeer;
  service: ConversationServiceLike;
  gate: MessagingGateLike;
  themeOverride?: "light" | "dark";
  markReadWhileLocked?: boolean;
  onBack: () => void;
  onOpenSettings: () => void; // themes, block, notifications
  onOpenDecisions?: () => void;
}

export function ConversationScreen(props: ConversationScreenProps) {
  const { conversationId, selfId, peer, service, gate, themeOverride, markReadWhileLocked } = props;
  const t = useConversationTheme(themeOverride);
  const c = useConversation({ conversationId, selfId, service, gate, markReadWhileLocked });
  const firstName = peer.displayName.split(/\s+/)[0] ?? peer.displayName;

  // Inverted list: index 0 is newest. Show time under the last bubble of a run.
  const renderItem = useCallback(
    ({ item, index }: { item: DisplayMessage; index: number }) => {
      const newer = c.messages[index - 1];
      const showMeta =
        !newer ||
        newer.senderId !== item.senderId ||
        Date.parse(newer.sentAt) - Date.parse(item.sentAt) > GROUP_GAP_MS;
      return (
        <MessageBubble message={item} theme={t} showMeta={showMeta} onRetry={c.retry} onDiscard={c.discard} />
      );
    },
    [c.discard, c.messages, c.retry, t]
  );

  const empty = !c.loading && !c.loadError && c.messages.length === 0;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: t.surface }]}>
      <ConversationHeader
        peer={peer}
        gate={c.gateState}
        theme={t}
        onBack={props.onBack}
        onOpenSettings={props.onOpenSettings}
        onOpenDecisions={props.onOpenDecisions}
      />

      <KeyboardAvoidingView
        style={[styles.fill, { backgroundColor: t.bg }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {c.loadError ? (
          <View style={[styles.notice, { backgroundColor: t.warnSurface }]}>
            <Text style={[type.meta, { color: t.ink, flex: 1 }]}>Couldn't load messages.</Text>
            <Pressable onPress={c.reload} accessibilityRole="button" hitSlop={8}>
              <Text style={[type.meta, { color: t.warn, fontWeight: "600" }]}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {empty ? (
          <View style={styles.empty}>
            <Text style={[type.title, { color: t.ink, textAlign: "center" }]}>No messages yet</Text>
            <Text style={[type.body, { color: t.inkMuted, textAlign: "center", marginTop: space.s }]}>
              {c.gateState.mode === "LIVE"
                ? `Start the conversation with ${firstName}.`
                : `You can start the conversation with ${firstName} once secure messaging is available on this device.`}
            </Text>
          </View>
        ) : (
          <FlatList
            testID="message-list"
            inverted
            data={c.messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            onEndReached={c.loadOlder}
            onEndReachedThreshold={0.4}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            ListFooterComponent={
              c.loading ? <ActivityIndicator style={{ margin: space.l }} color={t.inkMuted} /> : null
            }
          />
        )}

        <ComposerArea
          gate={c.gateState}
          theme={t}
          peerFirstName={firstName}
          onSend={c.send}
          onRecheck={c.recheck}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  listContent: { paddingVertical: space.s },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.l,
    paddingVertical: space.s,
  },
  empty: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl * 1.5 },
});
