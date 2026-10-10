import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  ConversationServiceLike,
  DisplayMessage,
  GateState,
  MessageBody,
  MessagingGateLike,
  ServerRow,
  isSecureCoreError,
} from "./types";

interface Options {
  conversationId: string;
  selfId: string;
  service: ConversationServiceLike;
  gate: MessagingGateLike;
  /** Current production behavior marks read even while sealed. Set false to stop that. */
  markReadWhileLocked?: boolean;
}

const SEALED: MessageBody = { state: "sealed" };

function mergeRows(prev: ServerRow[], incoming: ServerRow[]): ServerRow[] {
  const byId = new Map(prev.map((r) => [r.id, r]));
  for (const r of incoming) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export function useConversation({
  conversationId,
  selfId,
  service,
  gate,
  markReadWhileLocked = true,
}: Options) {
  const [gateState, setGateState] = useState<GateState>({ mode: "CHECKING" });
  const [rows, setRows] = useState<ServerRow[]>([]);
  const [opened, setOpened] = useState<Record<string, MessageBody>>({});
  const [pending, setPending] = useState<DisplayMessage[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const mounted = useRef(true);
  const gateRef = useRef<GateState>(gateState);
  const lastMarked = useRef<string | null>(null);
  const decrypting = useRef(new Set<string>());

  gateRef.current = gateState;
  const live = gateState.mode === "LIVE";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void evaluateGate();
    });
    return () => sub.remove();
  }, [evaluateGate]);

  // Leaving LIVE drops every plaintext body held in memory.
  useEffect(() => {
    if (!live) {
      setOpened({});
      setPending([]);
      decrypting.current.clear();
    }
  }, [live]);

  // History.
  const loadPage = useCallback(
    async (from?: string) => {
      setLoading(true);
      setLoadError(false);
      try {
        const page = await service.loadHistory(conversationId, from);
        if (!mounted.current) return;
        setRows((prev) => mergeRows(prev, page.rows));
        setCursor(page.nextCursor);
        setHasMore(Boolean(page.nextCursor));
      } catch {
        if (mounted.current) setLoadError(true);
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [conversationId, service]
  );

  useEffect(() => {
    setRows([]);
    lastMarked.current = null;
    void loadPage();
  }, [loadPage]);

  const loadOlder = useCallback(() => {
    if (!loading && hasMore && cursor) void loadPage(cursor);
  }, [cursor, hasMore, loadPage, loading]);

  // Live updates.
  useEffect(() => {
    if (!service.subscribe) return;
    return service.subscribe(conversationId, (row) => setRows((prev) => mergeRows(prev, [row])));
  }, [conversationId, service]);

  // Decrypt only in LIVE, only rows not yet attempted. One bad row stays one bad row.
  useEffect(() => {
    if (!live) return;
    const todo = rows.filter((r) => !opened[r.id] && !decrypting.current.has(r.id));
    if (todo.length === 0) return;
    todo.forEach((r) => decrypting.current.add(r.id));

    service
      .decryptServerRows(conversationId, todo)
      .then((results) => {
        if (!mounted.current || gateRef.current.mode !== "LIVE") return;
        const byId = new Map(results.map((r) => [r.id, r]));
        setOpened((prev) => {
          const next = { ...prev };
          for (const row of todo) {
            const res = byId.get(row.id);
            next[row.id] = res && res.ok ? { state: "open", text: res.text } : { state: "unreadable" };
          }
          return next;
        });
      })
      .catch((e) => {
        todo.forEach((r) => decrypting.current.delete(r.id));
        if (isSecureCoreError(e)) void evaluateGate();
      });
  }, [conversationId, evaluateGate, live, opened, rows, service]);

  // Mark read on the newest incoming row.
  useEffect(() => {
    if (!live && !markReadWhileLocked) return;
    const newestIncoming = [...rows].reverse().find((r) => r.senderId !== selfId);
    if (!newestIncoming || newestIncoming.id === lastMarked.current) return;
    lastMarked.current = newestIncoming.id;
    service.markRead(conversationId, newestIncoming.id).catch(() => {
      lastMarked.current = null;
    });
  }, [conversationId, live, markReadWhileLocked, rows, selfId, service]);

  // Sending.
  const send = useCallback(
    async (text: string, reuseId?: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed || gateRef.current.mode !== "LIVE") return false;

      const tempId = reuseId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const draft: DisplayMessage = {
        id: tempId,
        senderId: selfId,
        sentAt: new Date().toISOString(),
        outgoing: true,
        body: { state: "open", text: trimmed },
        delivery: "sending",
      };
      setPending((p) => [draft, ...p.filter((m) => m.id !== tempId)]);

      try {
        const row = await service.send(conversationId, trimmed);
        if (!mounted.current) return true;
        decrypting.current.add(row.id);
        setOpened((o) => ({ ...o, [row.id]: { state: "open", text: trimmed } }));
        setRows((r) => mergeRows(r, [row]));
        setPending((p) => p.filter((m) => m.id !== tempId));
        return true;
      } catch (e) {
        if (mounted.current) {
          setPending((p) => p.map((m) => (m.id === tempId ? { ...m, delivery: "failed" } : m)));
        }
        if (isSecureCoreError(e)) void evaluateGate();
        return false;
      }
    },
    [conversationId, evaluateGate, selfId, service]
  );

  const retry = useCallback(
    (tempId: string) => {
      const m = pending.find((p) => p.id === tempId);
      if (m && m.body.state === "open") void send(m.body.text, tempId);
    },
    [pending, send]
  );

  const discard = useCallback((tempId: string) => {
    setPending((p) => p.filter((m) => m.id !== tempId));
  }, []);

  // Newest first, for an inverted list.
  const messages = useMemo<DisplayMessage[]>(() => {
    const server: DisplayMessage[] = rows.map((r) => {
      const outgoing = r.senderId === selfId;
      return {
        id: r.id,
        senderId: r.senderId,
        sentAt: r.sentAt,
        outgoing,
        body: live ? opened[r.id] ?? SEALED : SEALED,
        delivery: outgoing ? "sent" : undefined,
      };
    });
    const all = live ? [...pending, ...server] : server;
    return all.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  }, [live, opened, pending, rows, selfId]);

  return {
    gateState,
    messages,
    loading,
    loadError,
    hasMore,
    loadOlder,
    reload: () => loadPage(),
    recheck: evaluateGate,
    send,
    retry,
    discard,
  };
}
