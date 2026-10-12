import type { PeerDirectory } from "./secureMessaging";

export interface InboxChat {
  conversationId: string;
  title: string;
  initials: string;
  isGroup: boolean;
  preview: string | null;
  updatedAt: string | null;
  unreadCount: number;
  muted: boolean;
  pinned: boolean;
  /** The other person on a direct chat; null for groups. */
  peerUserId: string | null;
  /** Recently active on a Linqa device (the server's own judgement). */
  online?: boolean;
  /** Archived by this person (hidden from the main list; the other people in the chat are not affected). */
  archived?: boolean;
  /** Which of this person's lists the chat is on. */
  listIds?: string[];
  /** Everyone in a group, this person included. Absent on direct chats. */
  memberUserIds?: string[];
}

export interface InboxCounts { all: number; unread: number; groups: number; favorites: number; archived: number }
export type ListColor = "violet" | "blue" | "green" | "orange" | "red" | "teal";
export interface ChatListInfo { id: string; name: string; color: ListColor; count: number }

export interface ChatControlsInfo {
  conversationId: string;
  isGroup: boolean;
  title: string;
  muted: boolean;
  pinned: boolean;
  archived: boolean;
  disappearAfterSeconds: number | null;
  peer: { userId: string; displayName: string; online: boolean; blockedByMe: boolean } | null;
  members: Array<{ userId: string; displayName: string; role: string }>;
  createdAt: string;
}
export type ReportCategory = "HARASSMENT" | "IMPERSONATION" | "THREATS" | "SCAM" | "SEXUAL_CONTENT" | "HATE" | "MINOR_SAFETY" | "OTHER";
export interface MessageRequestInfo { id: string; senderUserId: string; senderDisplayName: string; mutualContacts: number; riskLevel: string; createdAt: string }
export interface BlockedPerson { userId: string; displayName: string; blockedAt: string }

export interface LinkedDeviceInfo { id: string; deviceName: string; platform: string; registeredAt: string | null; lastSeenAt: string | null; current: boolean }
export interface FoundContact { id: string; displayName: string }

export interface ServerMessage { id: string; senderUserId: string; kind: string; ciphertext: string | null; createdAt: string }

export interface HistoryTransferView {
  id: string;
  status: "REQUESTED" | "APPROVED" | "UPLOADING" | "READY" | "COMPLETE" | "CANCELLED" | "DECLINED" | "FAILED";
  progress?: { done: number; total: number | null };
  chunkCount?: number | null;
  phoneOnline?: boolean;
  approverDeviceId?: string | null;
  failure?: string | null;
  expired?: boolean;
}

export class ChatApiError extends Error {
  constructor(readonly code: string, readonly status?: number) {
    super(code);
    this.name = "ChatApiError";
  }
}

/** The server calls the chat screen makes. Everything that leaves this class is already sealed; the server never sees text. */
export class ChatApi implements PeerDirectory {
  private readonly cache = new Map<string, { at: number; list: Array<{ deviceId: string; packageBase64: string }> }>();

  constructor(private readonly baseUrl: string, private readonly getAccessToken: () => Promise<string>) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${await this.getAccessToken()}`, ...(init.body === undefined ? {} : { "content-type": "application/json" }) }
      });
    } catch (error) {
      if (error instanceof Error && error.message === "SESSION_EXPIRED") throw error;
      throw new ChatApiError("NETWORK");
    }
    if (response.status === 204) return undefined as T;
    const data = (await response.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
    if (!response.ok) {
      const nested = data.error && typeof data.error === "object" ? (data.error as { code?: unknown }).code : undefined;
      const code = typeof data.code === "string" ? data.code : typeof data.error === "string" ? data.error : typeof nested === "string" ? nested : `HTTP_${response.status}`;
      throw new ChatApiError(code, response.status);
    }
    return data as T;
  }

  async inbox(): Promise<InboxChat[]> {
    return (await this.inboxWithCounts()).chats;
  }

  /** The main list (archived chats left out) with the numbers the filters show. */
  async inboxWithCounts(): Promise<{ chats: InboxChat[]; counts: InboxCounts }> {
    const payload = await this.request<{ conversations?: InboxChat[]; counts?: Partial<InboxCounts> }>("/v1/chats/inbox?filter=all&limit=100");
    const c = payload.counts ?? {};
    return { chats: payload.conversations ?? [], counts: { all: c.all ?? 0, unread: c.unread ?? 0, groups: c.groups ?? 0, favorites: c.favorites ?? 0, archived: c.archived ?? 0 } };
  }

  async archivedChats(): Promise<InboxChat[]> {
    const payload = await this.request<{ conversations?: InboxChat[] }>("/v1/chats/inbox?filter=archived&limit=100");
    return payload.conversations ?? [];
  }

  // ---- the chat menu: contact info, mute, disappearing messages, report, block, clear and delete ------------------------------
  async controls(conversationId: string): Promise<ChatControlsInfo> {
    return this.request(`/v1/chats/${encodeURIComponent(conversationId)}/controls`);
  }
  async setMuted(conversationId: string, muted: boolean): Promise<void> {
    await this.request(`/v1/chats/${encodeURIComponent(conversationId)}/mute`, { method: "POST", body: JSON.stringify({ muted }) });
  }
  async setDisappearing(conversationId: string, seconds: 86400 | 604800 | 2419200 | null): Promise<void> {
    await this.request(`/v1/chats/${encodeURIComponent(conversationId)}/disappearing`, { method: "POST", body: JSON.stringify({ seconds }) });
  }
  async report(conversationId: string, category: ReportCategory, description: string): Promise<void> {
    await this.request(`/v1/chats/${encodeURIComponent(conversationId)}/report`, { method: "POST", body: JSON.stringify({ category, description }) });
  }
  async clearChat(conversationId: string): Promise<void> {
    await this.request(`/v1/chats/${encodeURIComponent(conversationId)}/clear`, { method: "POST" });
  }
  async deleteMessage(conversationId:string,messageId:string,scope:'me'|'everyone'):Promise<void> { await this.request(`/v1/chats/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,{method:'DELETE',body:JSON.stringify({scope})}); }
  async visibleMessages(conversationId:string,messageIds:string[]):Promise<Set<string>> { const visible=new Set<string>();for(let i=0;i<messageIds.length;i+=500){const r=await this.request<{visibleMessageIds:string[]}>(`/v1/chats/${encodeURIComponent(conversationId)}/messages/visibility`,{method:'POST',body:JSON.stringify({messageIds:messageIds.slice(i,i+500)})});for(const id of r.visibleMessageIds)visible.add(id);}return visible;}
  async deleteChat(conversationId: string): Promise<void> {
    await this.request(`/v1/chats/${encodeURIComponent(conversationId)}/delete`, { method: "POST" });
  }
  async blockUser(userId: string): Promise<void> {
    await this.request("/v1/countrylinqa/blocked", { method: "POST", body: JSON.stringify({ userId }) });
  }
  async unblockUser(userId: string): Promise<void> {
    await this.request(`/v1/countrylinqa/blocked/${encodeURIComponent(userId)}`, { method: "DELETE" });
  }
  async blockedPeople(): Promise<BlockedPerson[]> {
    return (await this.request<{ items: BlockedPerson[] }>("/v1/countrylinqa/blocked")).items;
  }
  async messageRequests(): Promise<MessageRequestInfo[]> {
    return (await this.request<{ requests: MessageRequestInfo[] }>("/v1/message-requests")).requests;
  }
  async resolveMessageRequest(id: string, action: "ACCEPT" | "DECLINE" | "BLOCK"): Promise<void> {
    await this.request(`/v1/message-requests/${encodeURIComponent(id)}/resolve`, { method: "POST", body: JSON.stringify({ action }) });
  }

  // ---- organizing chats (all of it is shared with the phone through the server) ----------------------------------------------
  async chatLists(): Promise<ChatListInfo[]> {
    return (await this.request<{ lists: ChatListInfo[] }>("/v1/chat-lists")).lists;
  }
  async createList(name: string, color?: ListColor): Promise<ChatListInfo> {
    return this.request("/v1/chat-lists", { method: "POST", body: JSON.stringify({ name, ...(color ? { color } : {}) }) });
  }
  async renameList(id: string, name: string): Promise<void> {
    await this.request(`/v1/chat-lists/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) });
  }
  async deleteList(id: string): Promise<void> {
    await this.request(`/v1/chat-lists/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  async setInList(listId: string, conversationId: string, present: boolean): Promise<void> {
    await this.request(`/v1/chat-lists/${encodeURIComponent(listId)}/chats/${encodeURIComponent(conversationId)}`, { method: present ? "PUT" : "DELETE" });
  }
  async setArchived(conversationId: string, archived: boolean): Promise<void> {
    await this.request(`/v1/chats/${encodeURIComponent(conversationId)}/archive`, { method: "POST", body: JSON.stringify({ archived }) });
  }
  async setFavorite(conversationId: string, pinned: boolean): Promise<void> {
    await this.request(`/v1/chats/${encodeURIComponent(conversationId)}/pin`, { method: "POST", body: JSON.stringify({ pinned }) });
  }
  async createGroup(title: string, memberUserIds: string[]): Promise<string> {
    return (await this.request<{ conversationId: string }>("/v1/chats/groups", { method: "POST", body: JSON.stringify({ title, memberUserIds }) })).conversationId;
  }
  async addGroupMembers(conversationId: string, memberUserIds: string[]): Promise<number> {
    return (await this.request<{ added: number }>(`/v1/chats/${encodeURIComponent(conversationId)}/members`, { method: "POST", body: JSON.stringify({ memberUserIds }) })).added;
  }

  /** Newest first. */
  async history(conversationId: string, limit = 50): Promise<ServerMessage[]> {
    const page = await this.request<{ messages: ServerMessage[] }>(`/v1/chats/${encodeURIComponent(conversationId)}/messages?limit=${limit}`);
    return page.messages;
  }

  async send(conversationId: string, clientMessageId: string, ciphertext: string): Promise<{ id: string; createdAt?: string }> {
    return this.request(`/v1/chats/${encodeURIComponent(conversationId)}/messages`, { method: "POST", body: JSON.stringify({ clientMessageId, kind: "TEXT", ciphertext }) });
  }

  async markRead(conversationId: string): Promise<void> {
    await this.request(`/v1/chats/${encodeURIComponent(conversationId)}/read-state`, { method: "POST" });
  }

  /** A person's active devices' key packages. Kept for a minute so a burst of messages asks once. */
  async historicalSenderKey(context:{conversationId:string;messageId:string;senderUserId:string;senderDeviceId:string;ciphertextBase64:string}):Promise<number[]> {
    const {conversationId,messageId,...body}=context;
    const key=await this.request<{senderUserId:string;senderDeviceId:string;signingPublicKey:number[]}>(`/v1/chats/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/sender-key`,{method:'POST',body:JSON.stringify(body)});
    if(key.senderUserId!==context.senderUserId||key.senderDeviceId!==context.senderDeviceId||!Array.isArray(key.signingPublicKey))throw Error('SENDER_UNKNOWN');
    return key.signingPublicKey;
  }

  async keyPackages(userId: string, fresh=false): Promise<Array<{ deviceId: string; packageBase64: string }>> {
    const hit = this.cache.get(userId);
    if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.list;
    const { keyPackages } = await this.request<{ keyPackages: Array<{ deviceId: string; packageBase64: string }> }>(`/v1/users/${encodeURIComponent(userId)}/key-packages`);
    const list = keyPackages.map((k) => ({ deviceId: k.deviceId, packageBase64: k.packageBase64 }));
    this.cache.set(userId, { at: Date.now(), list });
    return list;
  }

  forgetKeyPackages(userId: string) { this.cache.delete(userId); }

  /** This account's own name, for the avatar. */
  async myName(): Promise<string> {
    const hub = await this.request<{ profile?: { display_name?: string } }>("/v1/mobile-hub");
    return hub.profile?.display_name ?? "";
  }

  async devices(): Promise<LinkedDeviceInfo[]> {
    return (await this.request<{ devices: LinkedDeviceInfo[] }>("/v1/devices")).devices;
  }

  async unlinkDevice(deviceId: string): Promise<void> {
    await this.request(`/v1/devices/${encodeURIComponent(deviceId)}/unlink`, { method: "POST" });
  }

  /** Looks a person up by phone number. Null when nobody on Linqa has it (or they cannot be messaged). */
  async findContact(phone: string): Promise<FoundContact | null> {
    const { contact } = await this.request<{ contact: FoundContact | null }>("/v1/chats/contacts/find", { method: "POST", body: JSON.stringify({ phone }) });
    return contact;
  }

  /** The direct conversation with a person, created if there is none yet. */
  async openDirect(userId: string): Promise<string> {
    return (await this.request<{ conversationId: string }>("/v1/chats/direct", { method: "POST", body: JSON.stringify({ userId }) })).conversationId;
  }

  // ---- older history, brought over from the phone -------------------------------------------------------------------------
  async requestHistory(): Promise<{ id: string }> {
    return this.request("/v1/history-transfers", { method: "POST" });
  }
  async historyTransfer(id: string): Promise<HistoryTransferView> {
    return this.request(`/v1/history-transfers/${encodeURIComponent(id)}`);
  }
  async historyChunk(id: string, seq: number): Promise<Uint8Array> {
    const { dataBase64 } = await this.request<{ dataBase64: string }>(`/v1/history-transfers/${encodeURIComponent(id)}/chunks/${seq}`);
    return Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0));
  }
  async completeHistory(id: string): Promise<void> {
    await this.request(`/v1/history-transfers/${encodeURIComponent(id)}/complete`, { method: "POST" });
  }
  async cancelHistory(id: string): Promise<void> {
    await this.request(`/v1/history-transfers/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  }

  async uploadFeatureBlob(conversationId:string,id:string,envelopeBase64:string):Promise<void>{
    await this.request(`/v2/chats/${encodeURIComponent(conversationId)}/media/${encodeURIComponent(id)}`,{method:'POST',body:JSON.stringify({envelopeBase64:envelopeBase64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')})});
  }
  async downloadFeatureBlob(conversationId:string,id:string):Promise<string>{
    const r=await this.request<{envelopeBase64:string}>(`/v2/chats/${encodeURIComponent(conversationId)}/media/${encodeURIComponent(id)}`);
    const value=r.envelopeBase64.replace(/-/g,'+').replace(/_/g,'/');return value+'='.repeat((4-value.length%4)%4);
  }
  async publishKeyPackage(deviceId: string, made: { packageBase64: string; packageVersion: number; expiresAt: string }): Promise<void> {
    await this.request(`/v1/devices/${encodeURIComponent(deviceId)}/key-package`, { method: "PUT", body: JSON.stringify(made) });
  }
}

/** What a message says on the chat list and in the thread, from the text it opened to. Typed messages from the phone get a label. */
export function describeBody(plaintext: string): { text: string; kind: "text" | "media" | "other" } {
  const trimmed = plaintext.trim();
  if (trimmed.startsWith("{")) {
    try {
      const body = JSON.parse(trimmed) as { type?: string; text?: string; caption?: string; mediaKind?: string; title?: string };
      switch (body.type) {
        case "text": return { text: String(body.text ?? ""), kind: "text" };
        case "media": {
          const label = body.mediaKind === "VOICE" ? "Voice message" : body.mediaKind === "VIDEO" ? "Video" : body.mediaKind === "GIF" ? "GIF" : "Photo";
          return { text: body.caption ? `${label}: ${body.caption}` : label, kind: "media" };
        }
        case "decision": return { text: `Poll: ${body.title ?? ""}`, kind: "other" };
        case "event": return { text: `Event: ${body.title ?? ""}`, kind: "other" };
        case "meeting": return { text: `Meeting: ${body.title ?? ""}`, kind: "other" };
        case "vote": return { text: "Voted in a poll", kind: "other" };
        case "feature": {
          const content=(body as unknown as {content?:{type?:string;name?:string;title?:string;label?:string;fileKind?:string}}).content;
          return {text:content?.type==='file'?content.name??'Attachment':content?.type==='event'?`Event: ${content.title??''}`:content?.type==='meeting'?`Meeting: ${content.title??''}`:content?.type==='location'?`Location: ${content.label??''}`:content?.type==='contact'?`Contact: ${content.name??''}`:content?.type==='event_rsvp'?'Event response':'Shared content',kind:'other'};
        }
        default: break;
      }
    } catch { /* not one of ours: shown as plain text */ }
  }
  return { text: plaintext, kind: "text" };
}
