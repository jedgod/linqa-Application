/**
 * Thin bridge to the WASM build of linqa-core.
 *
 * Once the core is compiled to WebAssembly and bindings are generated, this
 * module will call into it directly. For now it is backed by in-memory mock
 * data (src/mock/data.ts) so the UI shell has something real to render — the
 * async shape mirrors the eventual real API so swapping the implementation
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
import { initializeSecureMessagingRuntime } from "../messaging/SecureMessagingRuntime";
import type { ProductionMessagingCoordinator } from "../messaging/ProductionMessagingCoordinator";
import { getAccessToken, getApiBaseUrl } from "../app/apiSession";

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

/**
 * Security-runtime honesty layer.
 *
 * This is deliberately separate from the `CoreBridge` object above: that
 * object drives the visible conversation/chat mock data, while this layer
 * answers one narrow question — "is a real, audited encryption core
 * actually active right now?" — so the UI never claims end-to-end
 * encryption or post-quantum protection it cannot back up. As long as no
 * WASM build of linqa-core is loaded, this always reports non-encrypted
 * demo/unavailable states, regardless of what the mock conversation data
 * looks like.
 */
export type SecurityRuntimeState =
  | { kind: "demo"; encrypted: false; reason: string }
  | { kind: "loading"; encrypted: false }
  | { kind: "unavailable"; encrypted: false; reason: string }
  | { kind: "ready"; encrypted: true; coreVersion: string; pqcActive: boolean }
  | { kind: "failed"; encrypted: false; reason: string };

export interface SendMessageInput {
  conversationId: string;
  clientMessageId: string;
  body: string;
  recipientUserId?: string;
}

export interface SendMessageResult {
  clientMessageId: string;
  status: "stored-demo" | "queued-encrypted";
  createdAt: string;
}

export interface CoreAdapter {
  runtimeState(): Promise<SecurityRuntimeState>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
}

const DEMO_STORAGE_KEY = "linqa.demo.messages.v1";

function readDemoMessages(): SendMessageInput[] {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDemoMessages(messages: SendMessageInput[]): void {
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(messages));
}

export class DemoCoreAdapter implements CoreAdapter {
  async runtimeState(): Promise<SecurityRuntimeState> {
    return {
      kind: "demo",
      encrypted: false,
      reason: "Mock transport and local browser storage are active.",
    };
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    if (!input.conversationId.trim()) throw new Error("conversationId is required");
    if (!input.clientMessageId.trim()) throw new Error("clientMessageId is required");
    if (!input.body.trim()) throw new Error("message body is required");

    const messages = readDemoMessages();
    messages.push({ ...input, body: input.body.trim() });
    writeDemoMessages(messages);

    return {
      clientMessageId: input.clientMessageId,
      status: "stored-demo",
      createdAt: new Date().toISOString(),
    };
  }
}

export class WasmCoreAdapter implements CoreAdapter {
  private coordinator?: ProductionMessagingCoordinator;
  private runtime?: SecurityRuntimeState;

  async runtimeState(): Promise<SecurityRuntimeState> {
    if (this.runtime) return this.runtime;
    const raw = sessionStorage.getItem("linqa.auth.runtime");
    if (!raw) return { kind: "unavailable", encrypted: false, reason: "An enrolled device session is required." };
    const identity = JSON.parse(raw) as { authenticated?: boolean; userId?: string; deviceId?: string };
    if (!identity.authenticated || !identity.userId || !identity.deviceId || !getAccessToken()) {
      return { kind: "unavailable", encrypted: false, reason: "An enrolled device session is required." };
    }
    const active = await initializeSecureMessagingRuntime({
      apiBaseUrl: getApiBaseUrl(),
      accessToken: () => Promise.resolve(getAccessToken()),
      identity: { userId: identity.userId, deviceId: identity.deviceId }
    });
    this.coordinator = active.coordinator;
    this.runtime = {
      kind: "ready",
      encrypted: true,
      coreVersion: active.runtime.buildVersion,
      pqcActive: active.runtime.protocolVersion >= 1
    };
    return this.runtime;
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    if (!this.coordinator) await this.runtimeState();
    if (!this.coordinator) throw new Error("Secure messaging core unavailable; message was not sent.");
    if (!input.recipientUserId) throw new Error("A recipient user ID is required for encrypted delivery.");
    await this.coordinator.send({
      conversationId: input.conversationId,
      recipientUserId: input.recipientUserId,
      plaintext: input.body,
      clientMessageId: input.clientMessageId
    });
    return {
      clientMessageId: input.clientMessageId,
      status: "queued-encrypted",
      createdAt: new Date().toISOString()
    };
  }
}

export function createCoreAdapter(): CoreAdapter {
  const runtimeMode = import.meta.env.VITE_LINQA_RUNTIME_MODE ?? "HYBRID";
  const secureCoreEnabled = import.meta.env.VITE_SECURE_CORE_ENABLED === "true";
  if (import.meta.env.PROD || runtimeMode === "LIVE" || secureCoreEnabled) {
    return new WasmCoreAdapter();
  }
  return new DemoCoreAdapter();
}
