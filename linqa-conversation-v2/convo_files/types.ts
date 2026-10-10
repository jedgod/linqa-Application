// Shared types for the conversation page.
// The two "Like" interfaces describe what the screen needs. Map them onto the
// real ConversationService and ConversationMessagingGate with a thin adapter
// if their signatures differ.

export type LockReason = "SECURE_CORE_UNAVAILABLE" | "PROBE_FAILED" | "NOT_READY";

export type MessagingMode =
  | { mode: "LIVE" }
  | { mode: "LOCKED"; reason: LockReason };

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
}

export type DecryptResult =
  | { id: string; ok: true; text: string }
  | { id: string; ok: false };

export interface ConversationServiceLike {
  loadHistory(
    conversationId: string,
    cursor?: string
  ): Promise<{ rows: ServerRow[]; nextCursor?: string }>;
  /** Must never throw for a single bad row; report it as ok: false instead. */
  decryptServerRows(conversationId: string, rows: ServerRow[]): Promise<DecryptResult[]>;
  send(conversationId: string, text: string): Promise<ServerRow>;
  markRead(conversationId: string, upToMessageId: string): Promise<void>;
  subscribe?(conversationId: string, onRow: (row: ServerRow) => void): () => void;
}

export type MessageBody =
  | { state: "sealed" }
  | { state: "open"; text: string }
  | { state: "unreadable" };

export type Delivery = "sending" | "sent" | "failed";

export interface DisplayMessage {
  id: string;
  senderId: string;
  sentAt: string;
  outgoing: boolean;
  body: MessageBody;
  delivery?: Delivery;
}

export interface ConversationPeer {
  id: string;
  displayName: string;
}

export function isSecureCoreError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | undefined;
  return (
    err?.code === "SECURE_CORE_UNAVAILABLE" ||
    (typeof err?.message === "string" && err.message.includes("SECURE_CORE_UNAVAILABLE"))
  );
}
