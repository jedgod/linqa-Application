import { t, i18n } from '../i18n';
export type CallType = "AUDIO" | "VIDEO" | "SCREEN_SHARE";
export type CallStatus = "MISSED" | "REJECTED" | "COMPLETED" | "FAILED" | "CANCELLED";
export type PrivacyMode = "STANDARD" | "RELAY_ONLY";

export type CallHistoryItem = {
  /** ISO-3166 alpha-2 of the peer's *verified* country, never an IP guess. */
  peerCountryCode?: string | null;
  peerCountryName?: string | null;
  /** Path of the caller's profile photo; null when they have none. */
  peerAvatarUrl?: string | null;
  id: string;
  peerUserId: string;
  peerDisplayName: string;
  direction: "INCOMING" | "OUTGOING";
  callType: CallType;
  status: CallStatus;
  durationSeconds: number;
  createdAt: string;
};

export type ScheduledCall = {
  id: string;
  callType: "AUDIO" | "VIDEO";
  privacyMode: PrivacyMode;
  scheduledFor: string;
  status: string;
  isOrganizer: boolean;
  organizerUserId: string;
  organizerName: string;
  participantUserIds: string[];
  participantNames: string[];
  /** Server-owned: true from 10 minutes before the start until an hour after. */
  joinable: boolean;
  participantCount: number;
};

export type PlacedCall = {
  callId: string;
  /** The device that is ringing; signaling events are addressed to it. */
  calleeDeviceId: string;
  createdAt: string;
  mode: string;
  privacyMode: PrivacyMode;
};

export type UpcomingCall = {
  eventId: string;
  callType: "AUDIO" | "VIDEO";
  startsAt: string;
  participantCount: number;
  joinable: boolean;
};

export type JoinedScheduledCall = {
  callId: string;
  joinToken: string;
  expiresAt: string;
  callType: "AUDIO" | "VIDEO";
  privacyMode: PrivacyMode;
};

/**
 * Raised when the callee has no device that can ring. Distinct from a generic
 * failure so the UI can say "they have no active device" instead of a vague
 * error â€” the difference matters to the person trying to call.
 */
export class NoActiveDeviceError extends Error {
  constructor(peerName?: string) {
    super(
      peerName
        ? `${peerName} has no active device to ring right now.`
        : "That contact has no active device to ring right now."
    );
    this.name = "NoActiveDeviceError";
  }
}

/** Raised when this device's session cannot place calls (not device-bound). */
export class CallNotPermittedError extends Error {
  constructor() {
    super("This device is not enrolled for calling. Sign in again on this device.");
    this.name = "CallNotPermittedError";
  }
}

export class CallsService {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...(init.headers ?? {})
      }
    });

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload: unknown = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const envelope = payload as { code?: unknown; error?: unknown };
      const nested =
        envelope.error && typeof envelope.error === "object"
          ? (envelope.error as { code?: unknown }).code
          : undefined;
      const code =
        typeof envelope.code === "string"
          ? envelope.code
          : typeof envelope.error === "string"
            ? envelope.error
            : typeof nested === "string"
              ? nested
              : undefined;
      if (
        response.status === 409 &&
        (code === "recipient_has_no_active_device" || code === "PEER_UNAVAILABLE")
      ) {
        throw new NoActiveDeviceError();
      }
      if (
        (response.status === 401 || response.status === 403) &&
        (code === "device_bound_token_required" || code === "DEVICE_BOUND_TOKEN_REQUIRED")
      ) {
        throw new CallNotPermittedError();
      }
      throw new Error(code ?? `Call request failed (${response.status}).`);
    }

    return payload as T;
  }

  reportCall(callId: string, category: string, description: string): Promise<unknown> {
    return this.request("/v1/safety/reports", { method: "POST", body: JSON.stringify({ callId, category, description }) });
  }

  async listHistory(limit = 50): Promise<CallHistoryItem[]> {
    const payload = await this.request<{ items?: unknown[] }>(`/v1/calls/history?limit=${limit}`);
    return (payload.items ?? []).map((raw) => {
      const item = raw as Record<string, unknown>;
      return {
        id: String(item.id ?? ""),
        peerUserId: String(item.peerUserId ?? item.peer_user_id ?? ""),
        peerDisplayName: String(item.peerName ?? item.display_name ?? "Unknown contact"),
        direction: (String(item.direction ?? "OUTGOING").toUpperCase() === "INCOMING" ? "INCOMING" : "OUTGOING") as "INCOMING" | "OUTGOING",
        callType: (String(item.callType ?? item.call_type ?? "AUDIO").toUpperCase() as CallType),
        status: (String(item.status ?? "COMPLETED").toUpperCase() as CallStatus),
        durationSeconds: Number(item.durationSeconds ?? item.duration_seconds ?? 0),
        createdAt: String(item.createdAt ?? item.created_at ?? new Date().toISOString()),
        peerCountryCode: (item.peerCountryCode as string | null) ?? null,
        peerCountryName: (item.peerCountryName as string | null) ?? null,
        peerAvatarUrl: (item.peerAvatarUrl as string | null) ?? null
      };
    });
  }

  /**
   * The next scheduled call, with the server's own joinability verdict.
   *
   * `joinable` is not recomputed on the client: the window belongs to the
   * server, and a device with a skewed clock must not be able to talk itself
   * into a call room.
   */
  async upcoming(): Promise<UpcomingCall | null> {
    const payload = await this.request<{ item: UpcomingCall | null }>("/v1/calls/upcoming");
    return payload.item ?? null;
  }

  /**
   * Places a call. `recipientDeviceId` is intentionally not sent: the server
   * resolves the callee's most recently active device, because device ids are
   * not exposed to peers.
   */
  placeCall(input: {
    recipientUserId: string;
    callType: CallType;
    privacyMode?: PrivacyMode;
  }): Promise<PlacedCall> {
    return this.request<PlacedCall>("/v1/calls/place", {
      method: "POST",
      body: JSON.stringify({
        peerUserId: input.recipientUserId,
        media: input.callType,
        privacyMode: input.privacyMode ?? "RELAY_ONLY"
      })
    });
  }

  acceptCall(callId: string): Promise<void> {
    return this.request<void>(`/v1/calls/${callId}/accept`, { method: "POST" });
  }

  async incoming(): Promise<Array<{ callId: string; callType: "AUDIO" | "VIDEO"; privacyMode: PrivacyMode; callerUserId: string; callerDeviceId: string; callerName: string }>> {
    const payload = await this.request<{ items?: unknown[] }>("/v1/calls/incoming");
    return (payload.items ?? []) as never;
  }

  /** `reason` only matters before the call is answered: REJECTED when the callee declines, FAILED when the connection never came up. */
  endCall(callId: string, reason?: "REJECTED" | "FAILED"): Promise<void> {
    return this.request<void>(`/v1/calls/${callId}/end`, { method: "POST", ...(reason ? { body: JSON.stringify({ reason }) } : {}) });
  }

  /** The other person on a call: name and their own verified country (never an IP-based guess). */
  details(callId: string): Promise<{ callId: string; callType: CallType; privacyMode: PrivacyMode; status: string; role: "CALLER" | "CALLEE"; peerName: string; peerCountryCode: string | null; peerCountryName: string | null }> {
    return this.request(`/v1/calls/${callId}`);
  }

  async listScheduled(limit = 50): Promise<ScheduledCall[]> {
    const payload = await this.request<{ scheduled?: unknown[] }>(`/v1/calls/scheduled?limit=${limit}`);
    return (payload.scheduled ?? []).map((raw) => {
      const item = raw as Record<string, unknown>;
      return {
        id: String(item.id),
        callType: (item.callType ?? "AUDIO") as "AUDIO" | "VIDEO",
        privacyMode: (item.privacyMode ?? "RELAY_ONLY") as PrivacyMode,
        scheduledFor: String(item.scheduledFor),
        status: String(item.status ?? "SCHEDULED"),
        isOrganizer: Boolean(item.isOrganizer),
        organizerUserId: String(item.organizerUserId ?? ""),
        participantUserIds: Array.isArray(item.participantUserIds) ? (item.participantUserIds as unknown[]).map((id) => String(id)) : [],
        joinable: Boolean(item.joinable),
        organizerName: String(item.organizerName ?? "Linqa user"),
        participantNames: Array.isArray(item.participantNames)
          ? (item.participantNames as unknown[]).map((name) => String(name))
          : [],
        participantCount: Number(item.participantCount ?? 0)
      };
    });
  }

  schedule(input: {
    participantUserIds: string[];
    callType: "AUDIO" | "VIDEO";
    privacyMode: PrivacyMode;
    scheduledFor: string;
    titleCiphertextBase64?: string;
  }): Promise<{ id: string; status: string; scheduled_for: string }> {
    return this.request("/v1/calls/scheduled", { method: "POST", body: JSON.stringify(input) });
  }

  joinScheduledCall(scheduledCallId: string): Promise<JoinedScheduledCall> {
    return this.request<JoinedScheduledCall>(`/v1/calls/scheduled/${encodeURIComponent(scheduledCallId)}/join-token`, {
      method: "POST"
    });
  }

  cancelScheduled(scheduledCallId: string): Promise<void> {
    return this.request<void>(`/v1/calls/scheduled/${scheduledCallId}/cancel`, { method: "POST" });
  }

  async turnCredentials(): Promise<{ username: string; credential: string; urls: string[]; ttlSeconds: number }> {
    return this.request("/v1/calls/turn-credentials");
  }
}

/** "4m 12s" / "48s" / "1h 03m" â€” compact enough for a list row. */
export function formatCallDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const remainder = Math.round(seconds % 60);
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Total talk time across completed calls, as a human summary. */
export function formatTalkTime(seconds: number): string {
  if (seconds <= 0) return "0m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * Groups history into Today / Yesterday / weekday / date buckets. A flat list
 * of timestamps is hard to scan; date sections are how every call log reads.
 */
export function callDateBucket(iso: string, now = new Date()): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return t("Earlier");

  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDelta = Math.round((startOfDay(now) - startOfDay(when)) / 86_400_000);

  if (dayDelta <= 0) return t("Today");
  if (dayDelta === 1) return t("Yesterday");
  if (dayDelta < 7) return when.toLocaleDateString(i18n.language, { weekday: "long" });
  return when.toLocaleDateString(i18n.language, { month: "short", day: "numeric" });
}

/** Stable identity colour, so the same person keeps the same avatar tint. */
export function avatarTint(name: string): string {
  const palette = ["#6C4ADA", "#2F8FD6", "#D68A2F", "#12A594", "#C2478E", "#4D8BFF", "#E0663F"];
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return palette[Math.abs(hash) % palette.length]!;
}

/** Preset scheduling offsets â€” avoids pulling in a date-picker dependency. */
export function schedulePresets(now = new Date()): Array<{ key: string; label: string; at: Date }> {
  const round = (date: Date) => {
    const rounded = new Date(date);
    rounded.setSeconds(0, 0);
    rounded.setMinutes(Math.ceil(rounded.getMinutes() / 15) * 15);
    return rounded;
  };
  const inMinutes = (minutes: number) => round(new Date(now.getTime() + minutes * 60_000));
  const tomorrowAt = (hour: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(hour, 0, 0, 0);
    return date;
  };

  return [
    { key: "30m", label: "In 30 min", at: inMinutes(30) },
    { key: "1h", label: "In 1 hour", at: inMinutes(60) },
    { key: "3h", label: "In 3 hours", at: inMinutes(180) },
    { key: "tomorrow-9", label: "Tomorrow 9:00", at: tomorrowAt(9) },
    { key: "tomorrow-14", label: "Tomorrow 14:00", at: tomorrowAt(14) }
  ];
}

export function formatScheduledFor(iso: string, now = new Date()): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  const time = when.toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit" });
  const bucket = callDateBucket(iso, now);
  const isPast = when.getTime() < now.getTime();
  if (isPast) return `${time} (overdue)`;
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDelta = Math.round((startOfDay(when) - startOfDay(now)) / 86_400_000);
  if (dayDelta === 0) return `Today ${time}`;
  if (dayDelta === 1) return `Tomorrow ${time}`;
  if (dayDelta < 7) return `${when.toLocaleDateString(i18n.language, { weekday: "short" })} ${time}`;
  return `${bucket} ${time}`;
}
