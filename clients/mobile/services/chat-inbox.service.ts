/**
 * Client for the Chats inbox (`server/src/routes/chats.ts`).
 *
 * Narrower than `MobileHubService` on purpose: the Chats tab is opened far
 * more often than anything else, and it has no use for the hub's media index,
 * device list or community memberships.
 *
 * The contract carries a few fields the server does not populate yet
 * (`typingLabel`, `previewKind`, `missedCall`). They are optional and the UI
 * renders them only when present, so the screen is ready for a typing/presence
 * transport without inventing one in the meantime.
 */

export type ChatFilter = "all" | "unread" | "groups" | "pinned";
export type PreviewKind = "text" | "voice" | "photos" | "call" | "draft";
export type DeliveryState = "sending" | "sent" | "delivered" | "read" | "failed";

export const CHAT_FILTERS: ChatFilter[] = ["all", "unread", "groups", "pinned"];

export type ChatSummary = {
  conversationId: string;
  title: string;
  initials: string;
  isGroup: boolean;
  /** Initials of up to three other members, for the stacked group avatar. */
  participantInitials: string[];
  preview: string | null;
  updatedAt: string | null;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  online: boolean;
  e2eeVerified: boolean;
  /** The other member, on direct conversations only. Null for groups. */
  peerUserId: string | null;
  /** Present only once a typing transport exists; never guessed client-side. */
  typingLabel?: string;
  previewKind?: PreviewKind;
  previewDurationSeconds?: number;
  deliveryState?: DeliveryState;
  scheduledEvent?: boolean;
  missedCall?: "audio" | "video";
};

export type PresenceContact = {
  userId: string;
  displayName: string;
  initials: string;
  online: boolean;
};

export type ScheduledCallCard = {
  eventId: string;
  callType: string;
  startsAt: string;
  /** Server-owned: the client does not decide when the window opens. */
  joinable: boolean;
};

export type ChatInboxPayload = {
  generatedAt: string;
  unreadTotal: number;
  counts: Record<ChatFilter, number>;
  scheduledCall: ScheduledCallCard | null;
  presence: PresenceContact[];
  conversations: ChatSummary[];
};

export class ChatInboxService {
  constructor(
    private readonly baseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...(init.headers ?? {})
      }
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const data: unknown = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const body = data as { code?: string; error?: string };
      throw new Error(body.code ?? body.error ?? `Chat request failed (${response.status}).`);
    }
    return data as T;
  }

  inbox(filter: ChatFilter, signal?: AbortSignal): Promise<ChatInboxPayload> {
    return this.request<ChatInboxPayload>(
      `/v1/chats/inbox?filter=${encodeURIComponent(filter)}`,
      signal ? { signal } : {}
    );
  }

  markRead(conversationId: string): Promise<void> {
    return this.request<void>(`/v1/chats/${encodeURIComponent(conversationId)}/read`, {
      method: "POST"
    });
  }
}

/**
 * Collapses repeats by `conversationId` and orders pinned-first, newest-next.
 *
 * Keyed by id rather than by title on purpose: two different people with the
 * same display name are two conversations, and merging them would silently
 * hide one person's messages behind another's.
 */
export function deduplicateConversations(items: ChatSummary[]): ChatSummary[] {
  const byId = new Map<string, ChatSummary>();
  for (const item of items) {
    const current = byId.get(item.conversationId);
    if (!current || timestamp(item.updatedAt) > timestamp(current.updatedAt)) {
      byId.set(item.conversationId, item);
    }
  }
  return [...byId.values()].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return timestamp(b.updatedAt) - timestamp(a.updatedAt);
  });
}

/** A missing or malformed timestamp sorts last instead of throwing. */
function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Compact age for a conversation row: now, 12m, 3h, then the weekday. */
export function chatTimeLabel(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  const diff = Date.now() - parsed;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(parsed).toLocaleDateString(undefined, { weekday: "short" });
}

/**
 * Label for the scheduled-call card.
 *
 * `scheduled_calls.title_ciphertext` is encrypted with a key the server never
 * holds, so there is no title to show. The card is described by what *is*
 * known — the call type — rather than by a placeholder pretending to be one.
 */
export function scheduledCallLabel(call: ScheduledCallCard): string {
  return call.callType === "VIDEO" ? "Scheduled video call" : "Scheduled audio call";
}

export function scheduledCallWhen(call: ScheduledCallCard): string {
  const parsed = Date.parse(call.startsAt);
  if (Number.isNaN(parsed)) return "Time unavailable";
  const date = new Date(parsed);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? `Today · ${time}`
    : `${date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · ${time}`;
}
