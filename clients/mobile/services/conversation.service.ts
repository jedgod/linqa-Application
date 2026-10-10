import { accountScopeGeneration } from "./account-scope";
import { base64ToBytes } from "./secure-core";
import { sealMedia, decryptMediaBytes, mediaDigest } from "./conversation-file-crypto";
import { readMedia, cacheMedia } from "./conversation-media";
import type { MediaPayload } from "./conversation-engine";
import { validatePayload, type Payload } from "./conversation-engine";
import { fromThreadPayload, toThreadPayload, assertPayload } from "./conversation-thread";
import type { SealedTextOutbox } from "./sealed-text-outbox";
import { flushRetained, isDefiniteRejection, postWithRetention, safeCode } from "./rejected-outbox";
import type { ConversationServiceLike, DecryptResult, ServerRow } from "./conversation-types";

/**
 * The conversation page's connection to the app's chat API (`/v1/chats/...`).
 *
 * The server stores and returns ciphertext only. Opening and sealing a message belongs to the device's
 * secure core, reached through `SecureMessaging`. This build has no secure core registered, so the default
 * refuses with SECURE_CORE_UNAVAILABLE (the messaging gate is LOCKED, so the screen never even calls it).
 * There is deliberately no fallback that sends text in the clear or dresses plain text up as ciphertext.
 */

export type CryptoContext = { conversationId: string; senderUserId: string };

export interface SecureMessaging {
  /** Seals plaintext for the conversation; returns base64 ciphertext. Must bind the conversation and sender as associated data. */
  seal(plaintext: string, context: CryptoContext & { clientMessageId: string }): Promise<string>;
  /** Verifies and opens a message. Throws if it cannot be authenticated; never returns unverified plaintext. */
  open(ciphertextBase64: string, context: CryptoContext & { messageId: string }): Promise<string>;
}

const secureCoreUnavailable = () => Object.assign(new Error("SECURE_CORE_UNAVAILABLE"), { code: "SECURE_CORE_UNAVAILABLE" });
export const unavailableSecureMessaging: SecureMessaging = {
  async seal() { throw secureCoreUnavailable(); },
  async open() { throw secureCoreUnavailable(); }
};

type ApiMessage = { id: string; senderUserId: string; kind: string; ciphertext: string | null; createdAt: string };
export const POLL_MS = 4000;

/** The relay's own limit on one sealed body; a bundle over it could never be accepted, so it is refused before it is queued. */
export const MAX_SEALED_BYTES = 65_536;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
export function assertSendableCiphertext(ciphertext: unknown): asserts ciphertext is string {
  if (typeof ciphertext !== "string" || ciphertext.length < 16 || !BASE64.test(ciphertext)) throw new Error("INVALID_CIPHERTEXT");
  const bytes = (ciphertext.length / 4) * 3 - (ciphertext.endsWith("==") ? 2 : ciphertext.endsWith("=") ? 1 : 0);
  if (bytes > MAX_SEALED_BYTES) throw new Error("BATCH_TOO_LARGE");
}

const b64urlToB64 = (v: string) => { const s = v.replace(/-/g, "+").replace(/_/g, "/"); return s + "=".repeat((4 - (s.length % 4)) % 4); };
const b64ToB64url = (v: string) => v.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

type ApiAttachment = { id: string; kind: string; senderUserId: string; envelopeBase64: string; createdAt: string };
export type LocationShareRow = { id: string; state: "REQUESTED" | "SHARING"; ownerUserId: string; requestedBy: string; expiresAt: string | null; createdAt: string; envelopeBase64: string | null };

export class ConversationService implements ConversationServiceLike {
  private readonly scopeGeneration = accountScopeGeneration();
  private assertScope() { if (this.scopeGeneration !== accountScopeGeneration()) throw secureCoreUnavailable(); }
  private async mediaDeviceId() {
    this.assertScope();
    const token = await this.getAccessToken();
    this.assertScope();
    const part = token.split(".")[1];
    if (!part) throw new Error("DEVICE_SCOPE_REQUIRED");
    const claims = JSON.parse(String.fromCharCode(...base64ToBytes(b64urlToB64(part))));
    if (claims.user_id !== this.selfId || typeof claims.device_id !== "string" || !claims.device_id) throw new Error("DEVICE_SCOPE_REQUIRED");
    return claims.device_id as string;
  }
  constructor(
    private readonly baseUrl: string,
    private readonly getAccessToken: () => Promise<string>,
    private readonly selfId: string,
    private readonly secure: SecureMessaging = unavailableSecureMessaging,
    private readonly mediaFiles = { read: readMedia, cache: cacheMedia },
    private readonly mediaCrypto = { seal: sealMedia, open: decryptMediaBytes },
    private readonly outbox: SealedTextOutbox | null = null
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    this.assertScope();
    const token = await this.getAccessToken();
    this.assertScope();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...(init.headers ?? {}) }
      });
    } catch { throw new Error("NETWORK"); }
    this.assertScope();
    const text = await response.text();
    this.assertScope();
    let data: unknown = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
    if (!response.ok) {
      const body = data as { code?: unknown; error?: unknown };
      const nested = body.error && typeof body.error === "object" ? (body.error as { code?: unknown }).code : undefined;
      const reason = typeof body.code === "string" ? body.code : typeof body.error === "string" ? body.error : typeof nested === "string" ? nested : undefined;
      throw Object.assign(new Error(reason ?? (response.status === 429 ? "RATE_LIMITED" : `HTTP_${response.status}`)), { status: response.status, code: reason });
    }
    return data as T;
  }

  /** Ids of rows that came from the attachments endpoint, so they are opened as attachments (the pack's { kind } form). */
  private readonly attachmentIds = new Set<string>();
  private readonly attachmentSeals = new Map<string, { conversationId: string; plaintext: string; kind: string; sealed: string }>();
  private readonly sealedMedia = new Map<string, { envelope: string; key: string; descriptor: string; messageId: string }>();
  private readonly posting = new Map<string, Promise<{ id: string; createdAt?: string }>>();
  private readonly discarded = new Set<string>();

  async discardPending(messageId: string) {
    if (this.posting.has(messageId)) throw new Error("SEND_IN_PROGRESS");
    this.assertScope();
    this.discarded.add(messageId);
    try { await this.outbox?.remove(messageId); } catch (error) { this.discarded.delete(messageId); throw error; }
    for (const [id, entry] of this.sealedMedia) if (entry.messageId === messageId) this.sealedMedia.delete(id);
    this.attachmentSeals.delete(messageId);
  }

  private toRow(m: ApiMessage): ServerRow { return { id: m.id, senderId: m.senderUserId, sentAt: m.createdAt, ciphertext: m.ciphertext ?? "" }; }
  async uploadFeatureBlob(conversationId: string, id: string, sealed: string): Promise<void> {
    await this.request(`/v2/chats/${encodeURIComponent(conversationId)}/media/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ envelopeBase64: b64ToB64url(sealed) }) });
  }
  async downloadFeatureBlob(conversationId: string, id: string): Promise<string> {
    return b64urlToB64((await this.request<{ envelopeBase64: string }>(`/v2/chats/${encodeURIComponent(conversationId)}/media/${encodeURIComponent(id)}`)).envelopeBase64);
  }
  featureCapabilities(conversationId: string): Promise<{ aiImages: boolean; live: boolean }> { return this.request(`/v2/chats/${encodeURIComponent(conversationId)}/features`); }
  generateFeatureImage(conversationId: string, prompt: string, style: string): Promise<{ base64: string; mime: string }[]> {
    return this.request(`/v2/chats/${encodeURIComponent(conversationId)}/ai-images`, { method: "POST", body: JSON.stringify({ prompt, style, consent: true }) });
  }
  featureIceServers(conversationId: string): Promise<{ urls: string[]; username: string; credential: string }[]> { return this.request(`/v2/chats/${encodeURIComponent(conversationId)}/ice-servers`); }

  async loadHistory(conversationId: string, cursor?: string, limit = 40): Promise<{ rows: ServerRow[]; nextCursor?: string }> {
    const query = `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = await this.request<{ messages: ApiMessage[]; nextCursor: string | null }>(`/v1/chats/${encodeURIComponent(conversationId)}/messages${query}`);
    // Call and system records carry no ciphertext and are not conversation messages; they are left out here.
    const rows = page.messages.filter((m) => m.kind === "TEXT" && m.ciphertext).map((m) => this.toRow(m));
    // Attachments (events, meetings) arrive with the newest page. If they cannot be fetched this round the messages still load,
    // and ones already shown stay (the screen merges by id); the next refresh tries again.
    if (!cursor) {
      try {
        const extra = await this.request<{ attachments: ApiAttachment[] }>(`/v2/chats/${encodeURIComponent(conversationId)}/attachments?limit=40`);
        for (const a of extra.attachments) {
          if (!["EVENT", "MEETING", "LOCATION", "CONTACT"].includes(a.kind)) continue;
          this.attachmentIds.add(a.id);
          rows.push({ id: a.id, senderId: a.senderUserId, sentAt: a.createdAt, ciphertext: b64urlToB64(a.envelopeBase64) });
        }
      } catch { /* see above */ }
    }
    return { rows, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
  }

  async decryptServerRows(conversationId: string, rows: ServerRow[]): Promise<DecryptResult[]> {
    const results: DecryptResult[] = [];
    for (const row of rows) {
      try {
        const text = await this.secure.open(row.ciphertext, { conversationId, senderUserId: row.senderId, messageId: row.id });
        if (this.attachmentIds.has(row.id)) {
          const parsed = JSON.parse(text);
          const card = parsed?.kind === "LOCATION" || parsed?.kind === "CONTACT"
            ? validatePayload(parsed.payload)
            : fromThreadPayload(parsed);
          if (card && (parsed.kind === "LOCATION" || parsed.kind === "CONTACT") && card.type.toUpperCase() !== parsed.kind) throw new Error("ATTACHMENT_KIND_MISMATCH");
          results.push(card ? { id: row.id, ok: true, text: JSON.stringify(card) } : { id: row.id, ok: false });
        } else results.push({ id: row.id, ok: true, text });
      } catch (e) {
        // A missing secure core affects every row: let the caller lock the thread. Anything else is one bad row.
        if ((e as { code?: string })?.code === "SECURE_CORE_UNAVAILABLE") throw e;
        const code = (e as { code?: unknown })?.code;
        results.push({ id: row.id, ok: false, ...(typeof code === "string" ? { code } : {}) });
      }
    }
    return results;
  }

  async send(conversationId: string, payload: Payload, clientMessageId: string): Promise<ServerRow> {
    if (payload.type === "feature") validatePayload(payload);
    if (payload.type === "event" || payload.type === "meeting" || payload.type === "location" || payload.type === "contact") return this.sendAttachment(conversationId, payload, clientMessageId);
    let ciphertext: string;
    const previouslySealed = payload.type === "media" ? await this.outbox?.find(clientMessageId) : null;
    if (previouslySealed) { ciphertext = previouslySealed; }
    else if (payload.type === "media" && payload.localUri) {
      let sealed = this.sealedMedia.get(payload.mediaId);
      if (!sealed) {
        const data = await this.mediaFiles.read(payload.localUri, payload.mimeType);
        const file = await this.mediaCrypto.seal(data, { conversationId, senderUserId: this.selfId, mediaId: payload.mediaId, mimeType: payload.mimeType });
        const descriptor = await this.secure.seal(JSON.stringify({ ...payload, localUri: undefined, mediaKey: file.key, mediaDigest: mediaDigest(file.envelope) }), { conversationId, senderUserId: this.selfId, clientMessageId });
        assertSendableCiphertext(descriptor);
        sealed = { ...file, descriptor, messageId: clientMessageId };
        this.sealedMedia.set(payload.mediaId, sealed);
      }
      if (this.outbox?.media) {
        await this.outbox.media.put({ messageId: clientMessageId, conversationId, deviceId: await this.mediaDeviceId(), mediaId: payload.mediaId, envelope: sealed.envelope, ciphertext: sealed.descriptor });
      } else {
        await this.request(`/v2/chats/${encodeURIComponent(conversationId)}/media/${payload.mediaId}`, { method: "POST", body: JSON.stringify({ envelopeBase64: b64ToB64url(sealed.envelope) }) });
      }
      ciphertext = sealed.descriptor;
    } else {
      // A retry reuses the bytes sealed the first time: the same ciphertext under the same message id, never a second seal.
      const stored = payload.type === "media" ? null : await this.outbox?.find(clientMessageId) ?? null;
      if (stored) ciphertext = stored;
      else {
        const transmitted = payload.type === "media" ? { ...payload, localUri: undefined } : payload;
        ciphertext = await this.secure.seal(JSON.stringify(transmitted), { conversationId, senderUserId: this.selfId, clientMessageId });
        assertSendableCiphertext(ciphertext);
        if (payload.type !== "media") await this.outbox?.put(clientMessageId, conversationId, ciphertext);
      }
    }
    const message = await this.post(conversationId, clientMessageId, ciphertext);
    if (payload.type === "media") this.sealedMedia.delete(payload.mediaId);
    return { id: message.id, senderId: this.selfId, sentAt: message.createdAt ?? new Date().toISOString(), ciphertext };
  }

  /** The relay's verdict on a failed post, from the structured status and code (never the message text). */
  private classify(error: unknown): { permanent: boolean; code: string } {
    const e = error as { status?: unknown; code?: unknown } | null;
    const code = safeCode(e?.code);
    return { permanent: typeof e?.status === "number" && isDefiniteRejection(e.status, code), code };
  }

  /**
   * Posts one sealed message. On acceptance the outbox row goes. A definite refusal (see isDefiniteRejection) keeps the sealed row as
   * FAILED_PERMANENT and throws PersistedRejection so it can be shown and discarded; every other failure (offline, 401, 409, 429, 5xx,
   * unknown) leaves the row queued, byte for byte, for a later retry.
   */
  private async post(conversationId: string, clientMessageId: string, ciphertext: string): Promise<{ id: string; createdAt?: string }> {
    if (this.discarded.has(clientMessageId)) throw new Error("MESSAGE_DISCARDED");
    const current = this.posting.get(clientMessageId);
    if (current) return current;
    const pending = this.executePost(conversationId, clientMessageId, ciphertext);
    this.posting.set(clientMessageId, pending);
    try { return await pending; } finally { this.posting.delete(clientMessageId); }
  }

  private async executePost(conversationId: string, clientMessageId: string, ciphertext: string): Promise<{ id: string; createdAt?: string }> {
    let message: { id: string; createdAt?: string } | undefined;
    const send = async () => {
      const media = await this.outbox?.media?.find(clientMessageId);
      if (media) {
        if (media.conversationId !== conversationId || media.ciphertext !== ciphertext || media.deviceId !== await this.mediaDeviceId()) throw new Error("DEVICE_SCOPE_REQUIRED");
        await this.request(`/v2/chats/${encodeURIComponent(conversationId)}/media/${media.mediaId}`, { method: "POST", body: JSON.stringify({ envelopeBase64: b64ToB64url(media.envelope) }) });
      }
      message = await this.request<{ id: string; createdAt?: string }>(`/v1/chats/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST", body: JSON.stringify({ clientMessageId, kind: "TEXT", ciphertext })
      });
      await this.outbox?.remove(clientMessageId).catch(() => undefined);
    };
    if (this.outbox) await postWithRetention({ row: { conversationId, messageId: clientMessageId }, failures: this.outbox.failures, classify: (e) => this.classify(e), post: send });
    else await send();
    return message!;
  }

  /**
   * Re-posts sealed messages left from an earlier run or a lost connection. Call at startup, on returning to the foreground and
   * when the network comes back. Returns the ids the relay accepted. An uncertain failure stops the pass and the rest wait; a definite
   * refusal is kept as FAILED_PERMANENT, reported through onRejected, and the pass carries on.
   */
  async flushOutbox(onRejected?: (messageId: string, code: string) => void): Promise<string[]> {
    const outbox = this.outbox;
    if (!outbox) return [];
    const accepted: string[] = [];
    try {
      await flushRetained({
        rows: (await outbox.pending()).map((row) => ({ ...row, conversationId: row.conversationId })),
        post: async (row) => { await this.post(row.conversationId, row.messageId, row.ciphertext); accepted.push(row.messageId); },
        failures: outbox.failures, classify: (e) => this.classify(e), onRejected
      });
    } catch { /* an uncertain failure or a failed write ends the pass; every unsent row is still queued */ }
    return accepted;
  }

  async openMedia(conversationId: string, senderUserId: string, payload: MediaPayload): Promise<string> {
    if (payload.localUri) return payload.localUri;
    const response = await this.request<{ envelopeBase64: string }>(`/v2/chats/${encodeURIComponent(conversationId)}/media/${payload.mediaId}`);
    if (!payload.mediaKey) throw new Error("Missing media key");
    if (payload.mediaDigest && mediaDigest(b64urlToB64(response.envelopeBase64)) !== payload.mediaDigest) throw new Error("MEDIA_INTEGRITY_FAILED");
    const opened = this.mediaCrypto.open(b64urlToB64(response.envelopeBase64), payload.mediaKey, { conversationId, senderUserId, mediaId: payload.mediaId, mimeType: payload.mimeType });
    return this.mediaFiles.cache(payload.mediaId, payload.mimeType, opened);
  }

  /** Cards use the existing attachment relay. Retrying on this screen reuses the original seal. */
  private async sendAttachment(conversationId: string, payload: Extract<Payload, { type: "event" | "meeting" | "location" | "contact" }>, id: string): Promise<ServerRow> {
    this.assertScope();
    validatePayload(payload);
    const thread = payload.type === "location" || payload.type === "contact"
      ? { kind: payload.type === "location" ? "LOCATION" : "CONTACT", payload }
      : toThreadPayload(payload);
    if (payload.type === "event" || payload.type === "meeting") assertPayload(thread.kind as "EVENT" | "MEETING", toThreadPayload(payload));
    const plaintext = JSON.stringify(thread);
    let retained = this.attachmentSeals.get(id);
    if (retained && (retained.conversationId !== conversationId || retained.plaintext !== plaintext)) throw new Error("ATTACHMENT_ID_TAKEN");
    if (!retained) {
      retained = { conversationId, plaintext, kind: thread.kind, sealed: await this.secure.seal(plaintext, { conversationId, senderUserId: this.selfId, clientMessageId: id }) };
      assertSendableCiphertext(retained.sealed);
      this.assertScope();
      this.attachmentSeals.set(id, retained);
    }
    const sealed = retained.sealed;
    await this.request(`/v2/chats/${encodeURIComponent(conversationId)}/attachments`, { method: "POST", body: JSON.stringify({ id, kind: thread.kind, envelopeBase64: b64ToB64url(sealed) }) });
    this.attachmentIds.add(id);
    return { id, senderId: this.selfId, sentAt: new Date().toISOString(), ciphertext: sealed };
  }

  /** Asks the other person to share their location. Nothing is shared until they accept. */
  async requestLocation(conversationId: string, peerUserId: string, id: string): Promise<{ id: string; state: "REQUESTED" }> {
    return this.request(`/v2/chats/${encodeURIComponent(conversationId)}/location-requests`, { method: "POST", body: JSON.stringify({ id, peerUserId }) });
  }
  async locationShares(conversationId: string): Promise<LocationShareRow[]> {
    return (await this.request<{ shares: LocationShareRow[] }>(`/v2/chats/${encodeURIComponent(conversationId)}/location-shares`)).shares;
  }
  /** Declining needs no location and no encryption. */
  async declineLocation(shareId: string): Promise<void> {
    await this.request(`/v2/location-shares/${encodeURIComponent(shareId)}/answer`, { method: "POST", body: JSON.stringify({ accept: false }) });
  }
  /** Accepting seals the place first; the coordinates only ever leave the phone inside the envelope. */
  async shareLocation(input: { shareId: string; conversationId: string; label: string; latitude: number; longitude: number; minutes: number }): Promise<void> {
    const payload = { kind: "LOCATION" as const, label: input.label, latitude: input.latitude, longitude: input.longitude, liveMinutes: input.minutes };
    assertPayload("LOCATION", payload);
    if (!(input.minutes > 0 && input.minutes <= 480)) throw new Error("LOCATION_INVALID");
    const sealed = await this.secure.seal(JSON.stringify(payload), { conversationId: input.conversationId, senderUserId: this.selfId, clientMessageId: input.shareId });
    await this.request(`/v2/location-shares/${encodeURIComponent(input.shareId)}/answer`, { method: "POST", body: JSON.stringify({ accept: true, envelopeBase64: b64ToB64url(sealed), expiresAt: new Date(Date.now() + input.minutes * 60_000).toISOString() }) });
  }
  // ---- live screen share: signaling only (frames travel on the direct connection, never through the server) ----------

  /** Offers to share this phone's screen. The offer is sealed; the server relays it to the other person untouched. */
  async offerScreen(conversationId: string, sessionId: string): Promise<{ id: string; state: "OFFERED" }> {
    const sealed = await this.secure.seal(JSON.stringify({ kind: "LIVE_SCREEN", at: Date.now() }), { conversationId, senderUserId: this.selfId, clientMessageId: sessionId });
    return this.request(`/v2/chats/${encodeURIComponent(conversationId)}/screen-shares`, { method: "POST", body: JSON.stringify({ id: sessionId, offerEnvelopeBase64: b64ToB64url(sealed) }) });
  }
  /** The share open in this conversation, if any: the other person gets the offer to answer, the host gets the answer. */
  async screenShare(conversationId: string): Promise<{ id: string; state: "OFFERED" | "ACTIVE"; hostUserId: string; createdAt: string; envelopeBase64: string | null } | null> {
    return (await this.request<{ session: { id: string; state: "OFFERED" | "ACTIVE"; hostUserId: string; createdAt: string; envelopeBase64: string | null } | null }>(`/v2/chats/${encodeURIComponent(conversationId)}/screen-shares`)).session;
  }
  /** Declining needs no seal; accepting seals the answer first. */
  async answerScreen(conversationId: string, sessionId: string, accept: boolean): Promise<{ id: string; state: "ACTIVE" | "DECLINED" }> {
    const body = accept
      ? { accept: true, answerEnvelopeBase64: b64ToB64url(await this.secure.seal(JSON.stringify({ kind: "LIVE_SCREEN_ANSWER", at: Date.now() }), { conversationId, senderUserId: this.selfId, clientMessageId: sessionId })) }
      : { accept: false };
    return this.request(`/v2/screen-shares/${encodeURIComponent(sessionId)}/answer`, { method: "POST", body: JSON.stringify(body) });
  }
  async stopScreen(sessionId: string): Promise<void> {
    await this.request(`/v2/screen-shares/${encodeURIComponent(sessionId)}/stop`, { method: "POST", body: JSON.stringify({}) });
  }

  async stopLocation(shareId: string): Promise<void> {
    await this.request(`/v2/location-shares/${encodeURIComponent(shareId)}/stop`, { method: "POST", body: JSON.stringify({}) });
  }

  async markRead(conversationId: string): Promise<void> {
    await this.request(`/v1/chats/${encodeURIComponent(conversationId)}/read-state`, { method: "POST" });
  }

  /** This account's mute and pin for the conversation, and the conversation's disappearing-messages setting. */
  settings(conversationId: string): Promise<{ muted: boolean; pinned: boolean; disappearAfterSeconds: number | null }> {
    return this.request(`/v1/chats/${encodeURIComponent(conversationId)}/settings`);
  }

  async setPinned(conversationId: string, pinned: boolean): Promise<void> {
    await this.request(`/v1/chats/${encodeURIComponent(conversationId)}/pin`, { method: "POST", body: JSON.stringify({ pinned }) });
  }

  /** Off (null), 1 day, 1 week or 4 weeks, for everyone in the conversation. Applies to messages sent afterwards. */
  async setDisappearing(conversationId: string, seconds: number | null): Promise<void> {
    await this.request(`/v1/chats/${encodeURIComponent(conversationId)}/disappearing`, { method: "POST", body: JSON.stringify({ seconds }) });
  }

  /** Mutes or unmutes this conversation for this account; the server stops sending alerts for it. */
  async setMuted(conversationId: string, muted: boolean): Promise<void> {
    await this.request(`/v1/chats/${encodeURIComponent(conversationId)}/mute`, { method: "POST", body: JSON.stringify({ muted }) });
  }

  /** New messages arrive by checking the newest page every few seconds while the screen is open. */
  subscribe(conversationId: string, onRow: (row: ServerRow) => void): () => void {
    let stopped = false;
    const tick = async () => {
      try { const page = await this.loadHistory(conversationId, undefined, 20); if (!stopped) page.rows.forEach(onRow); } catch { /* the next tick tries again */ }
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }
}
