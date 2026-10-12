import { useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl } from "../config/api";
import { createMessagingGate } from "./conversation-gate";
import { parseBody, type Payload } from "./conversation-engine";
import { ConversationService } from "./conversation.service";
import type { ChatSummary } from "./chat-inbox.service";
import { RuntimeCapabilitiesService } from "./runtime-capabilities.service";
import { sharedSecureSession } from "./shared-secure-session";
import { accessTokenProvider } from "./session";

/**
 * The server cannot read messages, so it sends no preview. This reads the newest message of each chat on this phone, with the same
 * secure session the conversation uses, and turns it into the one-line preview the chat list shows. Results are kept by
 * conversation and update time, so a message is opened once.
 */
type Preview = Pick<ChatSummary, "preview" | "previewKind" | "previewDurationSeconds">;

const MAX_CHATS = 25;
const cache = new Map<string, Preview>();

function describe(payload: Payload | null, mine: boolean): Preview {
  const you = mine ? "You: " : "";
  if (!payload) return { preview: "Message", previewKind: "text" };
  switch (payload.type) {
    case "text": return { preview: you + payload.text.replace(/\s+/g, " ").slice(0, 120), previewKind: "text" };
    case "media":
      if (payload.mediaKind === "VOICE") return { preview: you + "Voice message", previewKind: "voice", ...(payload.durationMs ? { previewDurationSeconds: Math.round(payload.durationMs / 1000) } : {}) };
      if (payload.mediaKind === "VIDEO") return { preview: you + "Video", previewKind: "photos" };
      return { preview: you + (payload.caption ? payload.caption.slice(0, 100) : payload.mediaKind === "GIF" ? "GIF" : "Photo"), previewKind: "photos" };
    case "decision": return { preview: you + "Poll: " + payload.title.slice(0, 80), previewKind: "text" };
    case "event": return { preview: you + "Event: " + payload.title.slice(0, 80), previewKind: "text" };
    case "meeting": return { preview: you + "Meeting: " + payload.title.slice(0, 80), previewKind: "text" };
    case "vote": return { preview: you + "Voted in a poll", previewKind: "text" };
    default: return { preview: you + "Message", previewKind: "text" };
  }
}

/** The chat list with previews filled in where the phone could read the newest message. */
export function useChatPreviews(selfId: string, conversations: ChatSummary[]): ChatSummary[] {
  const [version, setVersion] = useState(0);
  const running = useRef(false);

  const service = useMemo(() => {
    const secure = sharedSecureSession(selfId);
    if (!secure) return null;
    const gate = createMessagingGate({ core: secure.device.asNativeCore(), capabilities: () => new RuntimeCapabilitiesService(getApiBaseUrl()).snapshot() });
    return { secure, gate, conversation: new ConversationService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken(), selfId, secure.messaging) };
  }, [selfId]);

  useEffect(() => {
    if (!service || running.current) return;
    const wanted = conversations.filter((c) => c.updatedAt && !c.preview && !cache.has(`${c.conversationId}:${c.updatedAt}`)).slice(0, MAX_CHATS);
    if (wanted.length === 0) return;
    running.current = true;
    let live = true;
    void (async () => {
      try {
        const state = await service.gate.evaluate?.();
        if (state && state.mode !== "LIVE") return;
      } catch { /* a gate that cannot be checked just means no previews */ }
      for (const chat of wanted) {
        if (!live) break;
        const key = `${chat.conversationId}:${chat.updatedAt}`;
        try {
          const page = await service.conversation.loadHistory(chat.conversationId, undefined, 1);
          const row = page.rows[0];
          if (!row) { cache.set(key, { preview: null }); continue; }
          const [result] = await service.conversation.decryptServerRows(chat.conversationId, [row]);
          cache.set(key, result && result.ok ? describe(parseBody(result.text), row.senderId === selfId) : { preview: "Encrypted message", previewKind: "text" });
        } catch {
          cache.set(key, { preview: "Encrypted message", previewKind: "text" });
        }
        if (live) setVersion((v) => v + 1);
      }
    })().finally(() => { running.current = false; if (live) setVersion((v) => v + 1); });
    return () => { live = false; running.current = false; };
  }, [service, conversations, selfId]);

  return useMemo(
    () => conversations.map((c) => {
      if (c.preview || !c.updatedAt) return c;
      const found = cache.get(`${c.conversationId}:${c.updatedAt}`);
      if (found?.preview) return { ...c, ...found };
      // Messages exist but could not be read here (yet): never claim there are none.
      return { ...c, preview: "Encrypted message", previewKind: "text" as const };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, version]
  );
}
