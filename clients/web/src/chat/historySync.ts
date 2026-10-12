import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatApi, HistoryTransferView } from "./chatApi";
import type { HistoryEntry, HistoryStore } from "./historyStore";
import type { SecureMessaging } from "./secureMessaging";

/**
 * Bringing older messages from the phone, as the person sees it:
 *   requesting → waiting for the phone → the phone is sending → opening the messages here → done
 * with Cancel at every step before the end, and a clear reason when it stops (declined, cancelled, expired, phone offline, error).
 */
export type HistorySyncState =
  | { step: "idle" }
  | { step: "requesting" }
  | { step: "waiting"; phoneOnline: boolean }
  | { step: "transferring"; done: number; total: number | null }
  | { step: "opening"; done: number; total: number }
  | { step: "complete"; messages: number }
  | { step: "failed"; reason: "declined" | "cancelled" | "expired" | "phone" | "error" };

export const FAILURE_TEXT: Record<Extract<HistorySyncState, { step: "failed" }>["reason"], string> = {
  declined: "You chose Not now on your phone.",
  cancelled: "The transfer was cancelled.",
  expired: "Your phone did not answer in time.",
  phone: "Your phone could not send the history.",
  error: "The history could not be opened on this computer."
};

const POLL_MS = 2500;
const OPEN_KEY = "linqa.web.history-transfer.open.v1";
const MAX_ENTRY_TEXT = 20_000;

interface ArchiveChunk { v: 1; tr: string; n: number; e: Array<{ c: string; i: string; s: string; t: string; p: string }> }
const isText = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** Checks one opened piece belongs to this transfer and this place in it, and keeps only well-formed messages. */
export function readArchiveChunk(bytes: Uint8Array, transferId: string, seq: number): Array<{ conversationId: string; entry: HistoryEntry }> {
  const chunk = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as ArchiveChunk;
  if (chunk?.v !== 1 || chunk.tr !== transferId || chunk.n !== seq || !Array.isArray(chunk.e)) throw new Error("ARCHIVE_MISMATCH");
  const out: Array<{ conversationId: string; entry: HistoryEntry }> = [];
  for (const e of chunk.e) {
    if (!isText(e?.c, 80) || !isText(e.i, 80) || !isText(e.s, 80) || !isText(e.t, 40) || typeof e.p !== "string" || e.p.length > MAX_ENTRY_TEXT) continue;
    if (Number.isNaN(Date.parse(e.t))) continue;
    out.push({ conversationId: e.c, entry: { id: e.i, senderUserId: e.s, at: e.t, text: e.p } });
  }
  return out;
}

export function useHistorySync(input: { api: ChatApi; messaging: SecureMessaging; store: HistoryStore; userId: string; onImported: () => void }) {
  const { api, messaging, store, userId, onImported } = input;
  const [state, setState] = useState<HistorySyncState>({ step: "idle" });
  const run = useRef(0);
  const transferId = useRef<string | null>(null);
  const importedCallback = useRef(onImported);
  importedCallback.current = onImported;

  const stop = useCallback(() => { run.current += 1; }, []);
  useEffect(() => stop, [stop]);

  const download = useCallback(async (view: HistoryTransferView, token: number) => {
    const total = view.chunkCount ?? 0;
    const approver = view.approverDeviceId;
    if (!approver) throw new Error("NO_APPROVER");
    let messages = 0;
    for (let seq = 0; seq < total; seq += 1) {
      if (run.current !== token) return;
      setState({ step: "opening", done: seq, total });
      const sealed = await api.historyChunk(view.id, seq);
      const plain = await messaging.openFromOwnDevice(sealed, userId, approver);
      const grouped = new Map<string, HistoryEntry[]>();
      for (const { conversationId, entry } of readArchiveChunk(plain, view.id, seq)) {
        const list = grouped.get(conversationId) ?? [];
        list.push(entry);
        grouped.set(conversationId, list);
      }
      for (const [conversationId, entries] of grouped) messages += await store.add(conversationId, entries);
    }
    if (run.current !== token) return;
    await api.completeHistory(view.id).catch(() => undefined);
    try { localStorage.removeItem(OPEN_KEY); } catch { /* storage unavailable */ }
    setState({ step: "complete", messages });
    importedCallback.current();
  }, [api, messaging, store, userId]);

  const start = useCallback(async () => {
    const token = ++run.current;
    setState({ step: "requesting" });
    try {
      // A request left open by an earlier page load would block a new one: close it first.
      try { const old = localStorage.getItem(OPEN_KEY); if (old) { localStorage.removeItem(OPEN_KEY); await api.cancelHistory(old).catch(() => undefined); } } catch { /* storage unavailable */ }
      const { id } = await api.requestHistory();
      transferId.current = id;
      try { localStorage.setItem(OPEN_KEY, id); } catch { /* storage unavailable */ }
      let downloading = false;
      let hiccups = 0;
      while (run.current === token) {
        let view: HistoryTransferView;
        try {
          view = await api.historyTransfer(id);
          hiccups = 0;
        } catch (cause) {
          // A busy server or a dropped connection is waited out; anything else (the request is gone, or not ours) stops the sync.
          const status = (cause as { status?: number })?.status;
          const code = (cause as { code?: string })?.code;
          const temporary = code === "NETWORK" || status === 429 || (status !== undefined && status >= 500);
          if (!temporary || (hiccups += 1) > 10) throw cause;
          await new Promise((r) => setTimeout(r, POLL_MS * 2));
          continue;
        }
        if (run.current !== token) return;
        switch (view.status) {
          case "REQUESTED": case "APPROVED":
            setState({ step: "waiting", phoneOnline: view.phoneOnline !== false });
            break;
          case "UPLOADING":
            setState({ step: "transferring", done: view.progress?.done ?? 0, total: view.progress?.total ?? null });
            break;
          case "READY":
            if (!downloading) { downloading = true; await download(view, token); return; }
            break;
          case "COMPLETE": setState({ step: "complete", messages: 0 }); return;
          case "DECLINED": setState({ step: "failed", reason: "declined" }); return;
          case "CANCELLED": setState({ step: "failed", reason: "cancelled" }); return;
          case "FAILED": setState({ step: "failed", reason: view.expired ? "expired" : "phone" }); return;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (cause) {
      if (run.current !== token) return;
      const code = (cause as { code?: string })?.code;
      // Already asked from this computer: pick that request up where it is rather than failing.
      setState({ step: "failed", reason: code === "EXPIRED" ? "expired" : "error" });
    }
  }, [api, download]);

  const cancel = useCallback(async () => {
    const id = transferId.current;
    run.current += 1;
    setState({ step: "failed", reason: "cancelled" });
    if (id) await api.cancelHistory(id).catch(() => undefined);
  }, [api]);

  const reset = useCallback(() => { run.current += 1; setState({ step: "idle" }); }, []);

  return { state, start, cancel, reset };
}
