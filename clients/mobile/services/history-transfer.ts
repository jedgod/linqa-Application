import * as Crypto from "expo-crypto";
import { getApiBaseUrl } from "../config/api";
import { secureCoreModule } from "../modules/linqa-secure-core";
import { ChatInboxService } from "./chat-inbox.service";
import { ConversationService } from "./conversation.service";
import { base64ToBytes, bytesToBase64, utf8, type KeyPackageJson } from "./secure-core";
import { sharedSecureSession } from "./shared-secure-session";
import { accessTokenProvider } from "./session";

/**
 * The phone's side of bringing older history to a linked computer: it lists what is waiting for approval, and once the person says yes
 * it opens its own copy of the older messages, packs them, seals every piece for that one computer, and uploads the sealed pieces.
 * The server only ever sees sealed chunks. A piece the computer cannot open, or anyone else, is useless.
 */
export interface PendingTransfer { id: string; computerName: string; requestedAt: string }
export type ExportPhase = "preparing" | "reading" | "sending" | "finishing";
export interface ExportProgress { phase: ExportPhase; done: number; total: number }

const CHATS_MAX = 30;
const PER_CHAT_MAX = 300;
const CHUNK_TARGET_BYTES = 40_000;
const ENVELOPE_LIFETIME_S = 7 * 86_400;

export class HistoryTransferCancelled extends Error { constructor() { super("CANCELLED"); } }

async function call<T>(path: string, init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}): Promise<T> {
  const token = await accessTokenProvider.getAccessToken();
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: init.method ?? "POST",
    headers: { authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) })
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  if (!response.ok) throw Object.assign(new Error(payload.error?.code ?? `HTTP_${response.status}`), { status: response.status, code: payload.error?.code });
  return payload as T;
}

export const historyTransfers = {
  pending: async () => (await call<{ items: PendingTransfer[] }>("/v1/history-transfers/pending", { method: "GET" })).items,
  approve: (id: string) => call<{ computerDeviceId: string }>(`/v1/history-transfers/${id}/approve`),
  decline: (id: string) => call<void>(`/v1/history-transfers/${id}/decline`),
  state: (id: string) => call<{ status: string }>(`/v1/history-transfers/${id}`, { method: "GET" }),
  putChunk: (id: string, seq: number, dataBase64: string, progress: { done: number; total: number }) => call<void>(`/v1/history-transfers/${id}/chunks/${seq}`, { method: "PUT", body: { dataBase64, progress } }),
  finish: (id: string, chunkCount: number) => call<void>(`/v1/history-transfers/${id}/finish`, { body: { chunkCount } }),
  fail: (id: string, code: string) => call<void>(`/v1/history-transfers/${id}/fail`, { body: { code } }),
  cancel: (id: string) => call<void>(`/v1/history-transfers/${id}/cancel`)
};

interface Entry { c: string; i: string; s: string; t: string; p: string }

/** Packs, seals and uploads this account's older messages for one computer. Throws HistoryTransferCancelled if `isCancelled` turns true. */
export async function exportHistory(input: {
  selfId: string;
  transferId: string;
  computerDeviceId: string;
  isCancelled: () => boolean;
  onProgress: (progress: ExportProgress) => void;
}): Promise<{ chunks: number; messages: number }> {
  const { selfId, transferId, computerDeviceId } = input;
  const check = () => { if (input.isCancelled()) throw new HistoryTransferCancelled(); };
  const secure = sharedSecureSession(selfId);
  const bridge = secureCoreModule();
  if (!secure || !bridge) throw new Error("SECURE_CORE_UNAVAILABLE");
  input.onProgress({ phase: "preparing", done: 0, total: 1 });
  await secure.device.ensure();
  const selfDevice = await secure.device.deviceId();

  // The computer's key package: what its chunks are sealed for.
  const packages = await secure.server.keyPackages(selfId);
  const target = packages.find((p) => p.deviceId === computerDeviceId);
  if (!target) throw new Error("COMPUTER_NOT_READY");
  await bridge.verifyKeyPackage(target.packageBase64);
  const pkg = JSON.parse(String.fromCharCode(...base64ToBytes(target.packageBase64))) as KeyPackageJson;
  if (pkg.user_id !== selfId || pkg.device_id !== computerDeviceId) throw new Error("COMPUTER_NOT_READY");
  check();

  const token = () => accessTokenProvider.getAccessToken();
  const inbox = new ChatInboxService(getApiBaseUrl(), token);
  const conversations = new ConversationService(getApiBaseUrl(), token, selfId, secure.messaging);
  const chats = (await inbox.inbox("all")).conversations.filter((c) => c.updatedAt).slice(0, CHATS_MAX);

  const sealChunk = async (seq: number, entries: Entry[]): Promise<string> => {
    const created = Math.floor(Date.now() / 1000);
    const plaintext = utf8(JSON.stringify({ v: 1, tr: transferId, n: seq, e: entries }));
    return bridge.encryptMessage(JSON.stringify({
      recipient_encryption_public_key: pkg.encryption_public_key,
      recipient_pq_encryption_public_key: pkg.pq_encryption_public_key,
      sender_user_id: selfId, sender_device_id: selfDevice,
      recipient_user_id: selfId, recipient_device_id: computerDeviceId,
      message_id: Crypto.randomUUID(), plaintext: Array.from(plaintext),
      created_at_unix: created, expires_at_unix: created + ENVELOPE_LIFETIME_S
    }));
  };

  let seq = 0;
  let buffer: Entry[] = [];
  let bufferBytes = 0;
  let messages = 0;
  const sealed: string[] = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    sealed.push(await sealChunk(seq, buffer));
    seq += 1;
    buffer = [];
    bufferBytes = 0;
  };

  // Read and open every chat's recent messages. The opened text is kept in memory only until it is sealed.
  for (let index = 0; index < chats.length; index += 1) {
    check();
    const chat = chats[index]!;
    input.onProgress({ phase: "reading", done: index, total: chats.length });
    let cursor: string | undefined;
    let taken = 0;
    while (taken < PER_CHAT_MAX) {
      const page = await conversations.loadHistory(chat.conversationId, cursor, 100);
      if (page.rows.length === 0) break;
      const opened = await conversations.decryptServerRows(chat.conversationId, page.rows);
      for (let i = 0; i < page.rows.length; i += 1) {
        const row = page.rows[i]!;
        const result = opened[i]!;
        if (!result.ok || taken >= PER_CHAT_MAX) continue;
        const entry: Entry = { c: chat.conversationId, i: row.id, s: row.senderId, t: row.sentAt, p: result.text };
        const size = result.text.length + 160;
        if (bufferBytes + size > CHUNK_TARGET_BYTES) await flush();
        buffer.push(entry);
        bufferBytes += size;
        taken += 1;
        messages += 1;
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
  }
  await flush();
  check();

  // Upload the sealed chunks.
  for (let n = 0; n < sealed.length; n += 1) {
    check();
    input.onProgress({ phase: "sending", done: n, total: sealed.length });
    // The envelope is already base64 of its JSON; the server stores those bytes as they are.
    await historyTransfers.putChunk(transferId, n, sealed[n]!, { done: n + 1, total: sealed.length });
  }
  input.onProgress({ phase: "finishing", done: sealed.length, total: sealed.length });
  await historyTransfers.finish(transferId, sealed.length);
  void bytesToBase64;
  return { chunks: sealed.length, messages };
}
