export type HubContact = {
  id: string;
  displayName: string;
  initials: string;
  colorHue: number;
  online: boolean;
  statusBody: string | null;
};

export type HubConversation = {
  id: string;
  isGroup: boolean;
  title: string;
  participantIds: string[];
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  lastMessagePreview: string;
  lastMessageAt: number;
};

export type HubStatus = { id: string; body: string; createdAt: number };
export type HubCall = { id: string; peerName: string; direction: string; callType: string; status: string; createdAt: number };
export type HubCommunity = { id: string; name: string; role: string; visibility: string };
export type HubMedia = { id: string; mediaType: string; conversationTitle: string; starred: boolean; createdAt: number };

export type HubSnapshot = {
  profile: { id: string; displayName: string };
  contacts: HubContact[];
  conversations: HubConversation[];
  statuses: HubStatus[];
  calls: HubCall[];
  communities: HubCommunity[];
  media: HubMedia[];
};

function initialsFor(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function hashHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

function instantMillis(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Real client for `server/src/routes/mobile-hub.ts`'s `/v1/dev/mobile-hub`
 * family — the same genuine, Postgres-backed (but single fixed demo
 * persona, disabled in production) "local preview" surface the Android
 * client's `CoreBridge.loadHub()`/`ConversationListScreen` already use.
 * Field mapping matches `CoreBridge.parseSnapshot` exactly.
 */
export class MobileHubService {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "x-linqa-demo-user": "galaxy",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...(init.headers ?? {})
      }
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = typeof data?.error === "string" ? data.error : `Hub request failed (${response.status}).`;
      throw new Error(message);
    }
    return data as T;
  }

  async loadHub(): Promise<HubSnapshot> {
    const root = await this.request<Record<string, any>>("/v1/dev/mobile-hub");
    return {
      profile: { id: root.profile.id, displayName: root.profile.display_name },
      contacts: (root.contacts as any[]).map((item) => ({
        id: item.id,
        displayName: item.display_name,
        initials: initialsFor(item.display_name),
        colorHue: hashHue(item.display_name),
        online: Boolean(item.online),
        statusBody: item.status_body ?? null
      })),
      conversations: (root.conversations as any[]).map((item) => ({
        id: item.id,
        isGroup: item.conversation_type !== "DIRECT",
        title: item.display_title,
        participantIds: item.participant_ids ?? [],
        unreadCount: item.unread_count ?? 0,
        pinned: Boolean(item.pinned),
        muted: Boolean(item.muted),
        lastMessagePreview: item.last_message_preview ?? "No messages yet",
        lastMessageAt: instantMillis(item.last_message_at)
      })),
      statuses: (root.statuses as any[]).map((item) => ({
        id: item.id,
        body: item.body,
        createdAt: instantMillis(item.created_at)
      })),
      calls: (root.calls as any[]).map((item) => ({
        id: item.id,
        peerName: item.peer_name ?? "Unknown",
        direction: item.direction,
        callType: item.call_type,
        status: item.status,
        createdAt: instantMillis(item.created_at)
      })),
      communities: (root.communities as any[]).map((item) => ({
        id: item.id,
        name: item.name,
        role: item.role,
        visibility: item.visibility
      })),
      media: (root.media as any[]).map((item) => ({
        id: item.id,
        mediaType: item.media_type,
        conversationTitle: item.conversation_title ?? "Conversation",
        starred: Boolean(item.starred),
        createdAt: instantMillis(item.created_at)
      }))
    };
  }

  publishStatus(body: string) {
    return this.request<{ id: string }>("/v1/dev/mobile-hub/statuses", { method: "POST", body: JSON.stringify({ body }) });
  }

  createConversation(recipientUserId: string) {
    return this.request<{ id: string }>("/v1/dev/mobile-hub/conversations", {
      method: "POST",
      body: JSON.stringify({ recipientUserId })
    });
  }

  createCall(peerUserId: string, video = false) {
    return this.request<{ id: string; created_at: string }>("/v1/dev/mobile-hub/calls", {
      method: "POST",
      body: JSON.stringify({ peerUserId, callType: video ? "VIDEO" : "AUDIO" })
    });
  }
}
