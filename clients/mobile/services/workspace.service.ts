import { fromBase64 as base64ToBytes, openJson, sealJson, toBase64 as bytesToBase64 } from "./workspace-crypto";
import type { CalendarEvent, EventContent, Note, NoteContent } from "./workspace-model";

export class WorkspaceApiError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

export type Organization = { id: string; name: string; slug: string; status: string; role: string };
export type OrganizationDetail = Organization & { createdAt: string; memberCount: number; enforcedPolicyCount: number };
export type DirectoryEntry = { userId: string; displayName: string | null; role: string };
export type OrgPolicy = { id: string; key: string; value: unknown; enforced: boolean; updatedAt: string };
export type AuditEntry = { id: string; actorUserId: string; eventType: string; targetType: string; targetId: string; createdAt: string };

export type PrivacyControls = {
  profileVisibility: "EVERYONE" | "CONTACTS" | "NOBODY";
  phoneDiscoverability: boolean;
  emailDiscoverability: boolean;
  usernameDiscoverability: boolean;
  readReceipts: boolean;
  typingIndicators: boolean;
  lastSeenVisibility: "EVERYONE" | "CONTACTS" | "NOBODY";
};

type ServerNote = { id: string; noteType: string; ciphertextBase64: string; createdAt: string; updatedAt: string };
type ServerEvent = { id: string; startsAt: string; endsAt: string; titleCiphertextBase64: string; descriptionCiphertextBase64: string | null };
type EventDetails = Omit<EventContent, "description">;

export type Deps = {
  apiBaseUrl: string;
  getAccessToken: () => Promise<string>;
  /** The Notes and Calendar key, derived on this phone. Called once per request that needs it. */
  getKey: () => Promise<Uint8Array>;
  random: (n: number) => Uint8Array;
  fetchImpl?: typeof fetch;
};

/**
 * Client for Notes, Calendar, Enterprise and privacy controls. Notes and events are sealed here before they're sent and
 * opened here after they arrive; the server only ever holds ciphertext. Anything that can't be opened (damaged, or sealed with
 * a key this phone doesn't have) is counted and reported, never shown as garbled text.
 */
export class WorkspaceService {
  constructor(private readonly d: Deps) {}

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const token = await this.d.getAccessToken();
    const response = await (this.d.fetchImpl ?? fetch)(this.d.apiBaseUrl + path, {
      method: init.method ?? "GET",
      headers: { accept: "application/json", authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new WorkspaceApiError(typeof payload?.error === "string" ? payload.error : "request_failed", response.status);
    }
    return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
  }

  // Notes
  async notes(): Promise<{ notes: Note[]; unreadable: number }> {
    const { items } = await this.request<{ items: ServerNote[] }>("/v2/notes");
    const key = await this.d.getKey();
    const notes: Note[] = [];
    let unreadable = 0;
    for (const item of items) {
      try {
        const content = openJson<NoteContent>(key, "note", base64ToBytes(item.ciphertextBase64));
        notes.push({ ...content, id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt });
      } catch { unreadable++; }
    }
    return { notes, unreadable };
  }

  private async sealNote(content: NoteContent) {
    return bytesToBase64(sealJson(await this.d.getKey(), "note", content, this.d.random));
  }

  async createNote(content: NoteContent): Promise<Note> {
    const created = await this.request<{ id: string; created_at: string; updated_at: string }>("/v2/notes", {
      method: "POST", body: { noteType: content.kind ?? "NOTE", ciphertextBase64: await this.sealNote(content), collaborators: [] }
    });
    return { ...content, id: created.id, createdAt: created.created_at, updatedAt: created.updated_at };
  }

  async saveNote(id: string, content: NoteContent): Promise<Note> {
    const saved = await this.request<ServerNote>(`/v2/notes/${encodeURIComponent(id)}`, { method: "PUT", body: { ciphertextBase64: await this.sealNote(content) } });
    return { ...content, id, createdAt: saved.createdAt, updatedAt: saved.updatedAt };
  }

  deleteNote(id: string) { return this.request<void>(`/v2/notes/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  // Calendar
  async events(window: { from: string; to: string }): Promise<{ events: CalendarEvent[]; unreadable: number }> {
    const { items } = await this.request<{ items: ServerEvent[] }>(`/v2/calendar/events?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`);
    const key = await this.d.getKey();
    const events: CalendarEvent[] = [];
    let unreadable = 0;
    for (const item of items) {
      try {
        const details = openJson<EventDetails>(key, "event", base64ToBytes(item.titleCiphertextBase64));
        const description = item.descriptionCiphertextBase64 ? openJson<{ text: string }>(key, "event-description", base64ToBytes(item.descriptionCiphertextBase64)).text : "";
        events.push({ ...details, description, id: item.id, startsAt: item.startsAt, endsAt: item.endsAt });
      } catch { unreadable++; }
    }
    return { events, unreadable };
  }

  private async sealEvent(content: EventContent) {
    const key = await this.d.getKey();
    const { description, ...details } = content;
    return {
      titleCiphertextBase64: bytesToBase64(sealJson(key, "event", details, this.d.random)),
      ...(description.trim() ? { descriptionCiphertextBase64: bytesToBase64(sealJson(key, "event-description", { text: description }, this.d.random)) } : {})
    };
  }

  async createEvent(content: EventContent, startsAt: Date, endsAt: Date): Promise<CalendarEvent> {
    const created = await this.request<{ id: string }>("/v2/calendar/events", {
      method: "POST", body: { ...(await this.sealEvent(content)), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), attendeeUserIds: [] }
    });
    return { ...content, id: created.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
  }

  async saveEvent(id: string, content: EventContent, startsAt: Date, endsAt: Date): Promise<CalendarEvent> {
    // An emptied description can't be expressed as "no change", so the sealed (empty) text is always sent on edit.
    const sealed = await this.sealEvent(content);
    const key = await this.d.getKey();
    const descriptionCiphertextBase64 = sealed.descriptionCiphertextBase64 ?? bytesToBase64(sealJson(key, "event-description", { text: "" }, this.d.random));
    await this.request(`/v2/calendar/events/${encodeURIComponent(id)}`, {
      method: "PUT", body: { titleCiphertextBase64: sealed.titleCiphertextBase64, descriptionCiphertextBase64, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
    });
    return { ...content, id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
  }

  deleteEvent(id: string) { return this.request<void>(`/v2/calendar/events/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  // Enterprise (read-only)
  async organizations() { return (await this.request<{ items: Organization[] }>("/v2/enterprise/organizations")).items; }
  organization(orgId: string) { return this.request<OrganizationDetail>(`/v2/enterprise/organizations/${encodeURIComponent(orgId)}`); }
  async directory(orgId: string) { return (await this.request<{ items: DirectoryEntry[] }>(`/v2/enterprise/organizations/${encodeURIComponent(orgId)}/directory`)).items; }
  async policies(orgId: string) { return (await this.request<{ items: OrgPolicy[] }>(`/v2/enterprise/organizations/${encodeURIComponent(orgId)}/policies`)).items; }
  async auditLog(orgId: string) { return (await this.request<{ items: AuditEntry[] }>(`/v2/enterprise/organizations/${encodeURIComponent(orgId)}/audit-log`)).items; }

  // Privacy controls
  privacyControls() { return this.request<PrivacyControls>("/v1/privacy/settings"); }
  savePrivacyControls(controls: PrivacyControls) { return this.request<void>("/v1/privacy/settings", { method: "PUT", body: controls }); }
}
