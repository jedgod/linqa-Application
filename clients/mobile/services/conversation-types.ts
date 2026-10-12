import type { Payload } from "./conversation-engine";

// Types for the conversation page (from the convo_files pack, adapted to the app's chat API).
// The two "Like" interfaces describe what the screen needs; `ConversationService` (conversation.service.ts)
// and `createMessagingGate` (conversation-gate.ts) are the real implementations.

export type LockReason = "SECURE_CORE_UNAVAILABLE" | "PROBE_FAILED" | "NOT_READY";

export type MessagingMode = { mode: "LIVE" } | { mode: "LOCKED"; reason: LockReason };

/** CHECKING is treated exactly like LOCKED everywhere: no plaintext, no composer. */
export type GateState = { mode: "CHECKING" } | MessagingMode;

export interface MessagingGateLike {
  evaluate(): Promise<MessagingMode>;
}

export interface ServerRow {
  id: string;
  senderId: string;
  sentAt: string; // ISO 8601
  ciphertext: string;
  deleted?: boolean;
}

export type DecryptResult = { id: string; ok: true; text: string } | { id: string; ok: false; code?: string };

export interface ConversationServiceLike {
  uploadFeatureBlob?(conversationId: string, blobId: string, ciphertextBase64: string): Promise<void>;
  downloadFeatureBlob?(conversationId: string, blobId: string): Promise<string>;
  featureCapabilities?(conversationId: string): Promise<{ aiImages: boolean; live: boolean }>;
  generateFeatureImage?(conversationId: string, prompt: string, style: string): Promise<{ base64: string; mime: string }[]>;
  featureIceServers?(conversationId: string): Promise<{ urls: string[]; username: string; credential: string }[]>;
  /** Newest first; `nextCursor` continues further back. */
  loadHistory(conversationId: string, cursor?: string): Promise<{ rows: ServerRow[]; nextCursor?: string }>;
  /** Must never throw for a single bad row; report it as ok: false. A secure-core failure may throw and re-checks the gate. */
  decryptServerRows(conversationId: string, rows: ServerRow[]): Promise<DecryptResult[]>;
  /** `clientMessageId` makes a retry safe: the server answers with the original message. */
  send(conversationId: string, payload: Payload, clientMessageId: string): Promise<ServerRow>;
  deleteMessage?(conversationId:string,messageId:string,scope:'me'|'everyone'):Promise<void>;
  discardPending?(clientMessageId: string): Promise<void>;
  openMedia?(conversationId: string, senderUserId: string, payload: Extract<Payload, { type: "media" }>): Promise<string>;
  markRead(conversationId: string, upToMessageId: string): Promise<void>;
  subscribe?(conversationId: string, onRow: (row: ServerRow) => void): () => void;
}

export type MessageBody =
  | { state: "sealed" }
  | { state: "open"; payload: Payload }
  | { state: "unreadable"; /** A failure that may clear (for example the sender's key is not available yet): offer Try again. */ retryable?: boolean; /** Short reason code (never message content), shown so a failure can be reported. */ code?: string };

export type Delivery = "sending" | "sent" | "failed";

export interface DisplayMessage {
  id: string;
  senderId: string;
  sentAt: string;
  outgoing: boolean;
  body: MessageBody;
  delivery?: Delivery;
  /** Why a send failed, in plain words (shown under the failed message). */
  failure?: string;
}

export interface ConversationPeer {
  id: string | null;
  displayName: string;
}

export function isSecureCoreError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | undefined;
  return err?.code === "SECURE_CORE_UNAVAILABLE" || (typeof err?.message === "string" && err.message.includes("SECURE_CORE_UNAVAILABLE"));
}
