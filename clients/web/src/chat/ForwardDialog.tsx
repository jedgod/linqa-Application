import { useState } from "react";
import { Dialog } from "./ChatDialogs";
import type { InboxChat } from "./chatApi";

const MAX_TARGETS = 5;

/** Pick the chats to send a message to. The message is sealed again for each chat, with the people in it. */
export function ForwardDialog({ chats, preview, onClose, onForward }: { chats: InboxChat[]; preview: string; onClose: () => void; onForward: (conversationIds: string[]) => Promise<void> }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = chats.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (id: string) => setChosen((all) => (all.includes(id) ? all.filter((x) => x !== id) : all.length < MAX_TARGETS ? [...all, id] : all));
  const go = async () => {
    setBusy(true); setError(null);
    try { await onForward(chosen); onClose(); } catch { setError("It could not be forwarded to every chat. Try again."); setBusy(false); }
  };
  return (
    <Dialog title="Forward message" onClose={onClose}>
      <p className="lc-forward-preview" aria-label="Message to forward">{preview.length > 140 ? `${preview.slice(0, 140)}…` : preview}</p>
      <input className="lc-select" aria-label="Search chats" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      <ul className="lc-people" aria-label="Chats">
        {shown.map((c) => (
          <li key={c.conversationId}>
            <label className="lc-check"><input type="checkbox" checked={chosen.includes(c.conversationId)} onChange={() => toggle(c.conversationId)} />{c.title}{c.isGroup ? " (group)" : ""}</label>
          </li>
        ))}
        {shown.length === 0 ? <li className="lc-dialog-note">No chats to forward to.</li> : null}
      </ul>
      {chosen.length >= MAX_TARGETS ? <p className="lc-dialog-note">You can forward to up to {MAX_TARGETS} chats at once.</p> : null}
      {error ? <p className="lc-dialog-note" role="alert" data-warn>{error}</p> : null}
      <div className="lc-dialog-actions">
        <button type="button" className="lc-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="lc-btn lc-btn-primary" disabled={chosen.length === 0 || busy} onClick={() => void go()}>{busy ? "Forwarding…" : chosen.length > 1 ? `Forward to ${chosen.length} chats` : "Forward"}</button>
      </div>
    </Dialog>
  );
}
