//useConversation.ts
import { discardLocalMedia } from "../../services/conversation-media";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { PersistedRejection } from "../../services/rejected-outbox";
import { ReceiveController, type ReceiveAdapter } from "../../services/receive-controller";
import { conversationError, parseBody, type Payload } from "../../services/conversation-engine";
import { buildMessages, mergeRows } from "../../services/conversation-state";
import {
  isSecureCoreError,
  type ConversationServiceLike,
  type DisplayMessage,
  type GateState,
  type MessagingGateLike,
  type ServerRow
} from "../../services/conversation-types";

/** Plain words for a failed send; an unrecognised failure also carries its short code so it can be reported. */
function failureText(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  const name = typeof code === "string" && /^[A-Z0-9_]{2,60}$/.test(code) ? code : e instanceof Error && /^[A-Z0-9_]{2,60}$/.test(e.message) ? e.message : undefined;
  const text = conversationError(name);
  return name && text.startsWith("Something went wrong") ? `${text} (${name})` : text;
}

const TRANSIENT_OPEN_CODES = new Set(["SENDER_UNKNOWN", "RECIPIENT_NOT_READY", "OWN_DEVICE_NOT_PUBLISHED", "NETWORK"]);
const codeOf = (e: unknown) => { const c = (e as { code?: unknown } | null)?.code; return typeof c === "string" ? c : ""; };

interface Options {
  conversationId: string;
  selfId: string;
  /** This device's id, part of the scope every opened message is bound to. */
  deviceId?: string;
  service: ConversationServiceLike;
  gate: MessagingGateLike;
  /** A new id for each message. Reused on retry so the server never stores a message twice. */
  newId: () => string;
  /** Marking read while sealed would say "seen" for messages nobody could open. Default: do not. */
  markReadWhileLocked?: boolean;
}

/**
 * Everything the conversation screen needs: the gate, the history, opening messages (only while LIVE),
 * sending, retrying and marking read. Anything that goes wrong with encryption locks the thread; it never
 * falls back to showing or sending text.
 */
export function useConversation({ conversationId, selfId, deviceId = "", service, gate, newId, markReadWhileLocked = false }: Options) {
  const [gateState, setGateState] = useState<GateState>({ mode: "CHECKING" });
  const [rows, setRows] = useState<ServerRow[]>([]);
  const [pending, setPending] = useState<DisplayMessage[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const mounted = useRef(true);
  const mediaDrafts = useRef(new Map<string, string>());
  const sendingIds = useRef(new Set<string>());
  const clearDrafts = () => { for (const uri of mediaDrafts.current.values()) void discardLocalMedia(uri); mediaDrafts.current.clear(); };
  const gateRef = useRef<GateState>(gateState);
  const lastMarked = useRef<string | null>(null);

  gateRef.current = gateState;
  const live = gateState.mode === "LIVE";

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearDrafts(); }; }, []);

  // Gate: any exception is a lock, never a pass.
  const evaluateGate = useCallback(async () => {
    setGateState({ mode: "CHECKING" });
    try {
      const result = await gate.evaluate();
      if (mounted.current) setGateState(result);
    } catch {
      if (mounted.current) setGateState({ mode: "LOCKED", reason: "PROBE_FAILED" });
    }
  }, [gate]);

  useEffect(() => {
    void evaluateGate();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") void evaluateGate(); });
    return () => sub.remove();
  }, [evaluateGate]);

  // Leaving LIVE drops every plaintext body held in memory.
  useEffect(() => {
    if (!live) { setPending([]); clearDrafts(); }
  }, [live]);

  const scopeNow = useRef(conversationId);
  scopeNow.current = conversationId;
  const loadPage = useCallback(async (from?: string) => {
    setLoading(true); setLoadError(false);
    try {
      const page = await service.loadHistory(conversationId, from);
      // A page that arrives after the screen moved to another conversation must not paint there.
      if (!mounted.current || scopeNow.current !== conversationId) return;
      setRows((prev) => mergeRows(prev, page.rows));
      setCursor(page.nextCursor);
      setHasMore(Boolean(page.nextCursor));
    } catch {
      if (mounted.current) setLoadError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [conversationId, service]);

  useEffect(() => { setRows([]); lastMarked.current = null; void loadPage(); }, [loadPage]);

  const loadOlder = useCallback(() => { if (!loading && hasMore && cursor) void loadPage(cursor); }, [cursor, hasMore, loadPage, loading]);

  useEffect(() => {
    if (!service.subscribe) return;
    return service.subscribe(conversationId, (row) => setRows((prev) => mergeRows(prev, [row])));
  }, [conversationId, service]);

  // Opening goes through the receive controller: it drops everything held for an old scope or gate state before anything can
  // paint, retries only failures that may clear, and keeps a tampered or unverifiable message blocked.
  const evaluateGateRef = useRef(evaluateGate);
  evaluateGateRef.current = evaluateGate;
  const adapter = useMemo<ReceiveAdapter>(() => ({
    async readOrOpenAndCommit(scope, row) {
      try {
        const [result] = await service.decryptServerRows(scope.conversationId, [row]);
        if (result?.ok) return result.text;
        const code = result && !result.ok && result.code ? result.code : "OPEN_FAILED";
        throw Object.assign(new Error(code), { code });
      } catch (e) {
        if (isSecureCoreError(e)) void evaluateGateRef.current();
        throw e;
      }
    },
    // Only "the sender's or recipient's key is not available yet" can clear by itself; everything else (a failed check, a replay, a
    // malformed message, anything unknown) stays blocked.
    classify: (e) => TRANSIENT_OPEN_CODES.has(codeOf(e)) ? "transient" : "blocked",
    safeCode: (e) => (/^[A-Z0-9_]{1,80}$/.test(codeOf(e)) ? codeOf(e) : "OPEN_FAILED"),
    markRead: (scope, id) => service.markRead(scope.conversationId, id)
  }), [service]);
  const [receiveVersion, setReceiveVersion] = useState(0);
  const receiver = useMemo(() => new ReceiveController(adapter, parseBody, () => setReceiveVersion((n) => n + 1)), [adapter]);
  useLayoutEffect(() => {
    receiver.enter({ accountId: selfId, deviceId, conversationId }, live);
    return () => receiver.enter({ accountId: selfId, deviceId, conversationId }, false);
  }, [receiver, selfId, deviceId, conversationId, live]);
  useEffect(() => {
    if (!live) return;
    for (const row of rows) void receiver.open(row);
  }, [live, receiver, rows]);
  const retryOpen = useCallback((id: string) => {
    const row = rows.find((r) => r.id === id);
    if (row && receiver.retryable(id)) void receiver.open(row, { explicit: true });
  }, [receiver, rows]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const opened = useMemo(() => receiver.view(), [receiver, receiveVersion]);

  // Mark read up to the newest incoming row that has been opened, never past one that has not (oldest to newest).
  useEffect(() => {
    if (live) { void receiver.markOpenedRead(rows, selfId).catch(() => undefined); return; }
    if (!markReadWhileLocked) return;
    const newestIncoming = [...rows].reverse().find((r) => r.senderId !== selfId);
    if (!newestIncoming || newestIncoming.id === lastMarked.current) return;
    lastMarked.current = newestIncoming.id;
    service.markRead(conversationId, newestIncoming.id).catch(() => { lastMarked.current = null; });
  }, [conversationId, live, markReadWhileLocked, receiveVersion, receiver, rows, selfId, service]);

  const send = useCallback(async (payload: Payload, reuseId?: string): Promise<boolean> => {
    if (gateRef.current.mode !== "LIVE") return false;
    const tempId = reuseId ?? newId();
    if (sendingIds.current.has(tempId)) return false;
    sendingIds.current.add(tempId);
    if (payload.type === "media" && payload.localUri) mediaDrafts.current.set(tempId, payload.localUri);
    const draft: DisplayMessage = { id: tempId, senderId: selfId, sentAt: new Date().toISOString(), outgoing: true, body: { state: "open", payload }, delivery: "sending" };
    setPending((p) => [draft, ...p.filter((m) => m.id !== tempId)]);
    try {
      const row = await service.send(conversationId, payload, tempId);
      if (!mounted.current) return true;
      if (gateRef.current.mode !== "LIVE") return true;
      receiver.seed(row.id, payload);
      setRows((r) => mergeRows(r, [row]));
      setPending((p) => p.filter((m) => m.id !== tempId));
      return true;
    } catch (e) {
      // A refusal already kept on disk is shown by the Not sent panel; a temporary failed bubble would duplicate it.
      if (mounted.current) setPending((p) => e instanceof PersistedRejection ? p.filter((m) => m.id !== tempId) : p.map((m) => (m.id === tempId ? { ...m, delivery: "failed", failure: failureText(e) } : m)));
      if (isSecureCoreError(e)) void evaluateGate();
      return false;
    } finally { sendingIds.current.delete(tempId); }
  }, [conversationId, evaluateGate, newId, receiver, selfId, service]);

  const retry = useCallback((tempId: string) => {
    const m = pending.find((p) => p.id === tempId);
    if (m && m.body.state === "open") void send(m.body.payload, tempId);
  }, [pending, send]);

  const discard = useCallback(async (tempId: string) => {
    if (sendingIds.current.has(tempId)) return;
    try { await service.discardPending?.(tempId); } catch { return; }
    const uri = mediaDrafts.current.get(tempId);
    if (uri) { void discardLocalMedia(uri); mediaDrafts.current.delete(tempId); }
    setPending((p) => p.filter((m) => m.id !== tempId));
  }, [service]);

  const messages = useMemo(() => buildMessages({ live, rows, opened, pending, selfId }), [live, opened, pending, rows, selfId]);

  return { gateState, messages, loading, loadError, hasMore, loadOlder, reload: () => loadPage(), recheck: evaluateGate, send, retry, discard, retryOpen };
}
