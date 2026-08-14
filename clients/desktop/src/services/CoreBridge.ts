/**
 * Frontend bridge that will later call Tauri commands, which in turn call
 * linqa-core on the Rust side (see src-tauri/src/lib.rs).
 *
 * For now it is backed by in-memory mock data (src/mock/data.ts) so the UI
 * shell has something real to render — the async shape mirrors the eventual
 * `invoke("list_conversations")`-style API so swapping the implementation
 * later shouldn't require UI changes.
 */
import type { Conversation, LinkedDevice, Message, Profile } from "../types";
import {
  conversations,
  devices,
  messagesByConversation,
  profile,
  ME_ID,
} from "../mock/data";

function delay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export const CoreBridge = {
  isNativeLoaded(): boolean {
    return false;
  },

  versionPlaceholder(): string {
    return "linqa-core not loaded (mock data backing the UI)";
  },

  async getProfile(): Promise<Profile> {
    return delay(profile);
  },

  async listConversations(): Promise<Conversation[]> {
    return delay([...conversations]);
  },

  async listMessages(conversationId: string): Promise<Message[]> {
    return delay([...(messagesByConversation[conversationId] ?? [])]);
  },

  async sendMessage(conversationId: string, text: string): Promise<Message> {
    const message: Message = {
      id: `local-${Date.now()}`,
      conversationId,
      senderId: ME_ID,
      text,
      sentAt: Date.now(),
      status: "sending",
      isMine: true,
    };
    const list = messagesByConversation[conversationId];
    if (list) list.push(message);
    await delay(null, 150);
    message.status = "sent";
    return message;
  },

  async listDevices(): Promise<LinkedDevice[]> {
    return delay([...devices]);
  },

  async beginDeviceLink(): Promise<{ linkCode: string }> {
    const linkCode = Array.from({ length: 4 }, () =>
      Math.random().toString(36).slice(2, 6).toUpperCase()
    ).join("-");
    return delay({ linkCode }, 200);
  },
};
