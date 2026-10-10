import React from "react";
import { Modal, Pressable, Text, View } from "react-native";
import type { Theme } from "../../services/conversation-engine";
import { EmojiPanel, useEmojiSheet } from "../../src/features/emoji";

export type ComposerAction = "GIF" | "AI" | "Edit" | "Search" | "Select";

/**
 * The tools row (GIF, AI, Edit, Search, Select) over the emoji sheet. Emoji go into the message being typed and the sheet stays
 * open; a sticker is sent at once as its own message. The composer itself stays outside the sheet.
 */
export function ComposerMenu({ visible, theme: t, onPick, onEmoji, onSticker, onClose }: {
  visible: boolean;
  theme: Theme;
  onPick: (action: ComposerAction) => void;
  onEmoji: (emoji: string) => void;
  /** A sticker goes out as its own message. */
  onSticker?: (emoji: string) => void;
  onClose: () => void;
}) {
  const sheet = useEmojiSheet({
    onInsert: onEmoji,
    onSendSticker: onSticker ? (sticker) => { onSticker(sticker.emoji); onClose(); } : undefined
  });
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close emoji menu" onPress={onClose} style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.35)" }}>
        <Pressable onPress={() => undefined} style={{ paddingTop: 12, paddingBottom: 44, backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, marginBottom: 4 }}>
            {(["GIF", "AI", "Edit", "Search", "Select"] as const).map((action) => (
              <Pressable key={action} accessibilityRole="button" onPress={() => { onClose(); onPick(action); }} style={{ padding: 10, minHeight: 44 }}>
                <Text style={{ color: t.accent, fontWeight: "600" }}>{action}</Text>
              </Pressable>
            ))}
          </View>
          <EmojiPanel sheet={sheet} theme={t} onClose={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
