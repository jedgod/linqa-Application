import type {DesktopFeature} from './features/DesktopFeatures';
import { useEffect, useState, type ReactNode } from "react";
import type { BlockedPerson, ChatApi, ChatControlsInfo, MessageRequestInfo, ReportCategory } from "./chatApi";
import { ChatApiError } from "./chatApi";
import { Dialog } from "./ChatDialogs";
import {
  CameraIcon, CloseIcon, LockSolidIcon, MicIcon, PaperclipIcon, PhoneIcon, ShieldIcon, UserPlusIcon, VideoIcon,
} from "./ChatIcons";

const since = (iso: string) => new Date(iso).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });

export function ConfirmDialog({ title, body, confirm, danger, onConfirm, onClose }: { title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setError(null);
    try { await onConfirm(); onClose(); } catch { setError("That did not work. Check your connection and try again."); setBusy(false); }
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="lc-dialog-note">{body}</p>
      {error ? <p className="lc-dialog-note" role="alert" data-warn>{error}</p> : null}
      <div className="lc-dialog-actions">
        <button type="button" className="lc-btn" onClick={onClose}>Cancel</button>
        <button type="button" className={danger ? "lc-btn lc-btn-danger" : "lc-btn lc-btn-primary"} disabled={busy} onClick={() => void go()}>{busy ? "Working…" : confirm}</button>
      </div>
    </Dialog>
  );
}

export function ContactInfoDialog({ info, onClose }: { info: ChatControlsInfo; onClose: () => void }) {
  return (
    <Dialog title={info.isGroup ? "Group info" : "Contact info"} onClose={onClose}>
      <div className="lc-info-head"><strong>{info.title}</strong>{info.peer ? <span className="lc-presence" data-off={!info.peer.online}><i />{info.peer.online ? "Online" : "Offline"}</span> : null}</div>
      <dl className="lc-info">
        <div><dt>Encryption</dt><dd><LockSolidIcon size={14} /> End-to-end encrypted</dd></div>
        <div><dt>Notifications</dt><dd>{info.muted ? "Muted" : "On"}</dd></div>
        <div><dt>Disappearing messages</dt><dd>{disappearLabel(info.disappearAfterSeconds)}</dd></div>
        <div><dt>Chat started</dt><dd>{since(info.createdAt)}</dd></div>
        {info.peer?.blockedByMe ? <div><dt>Status</dt><dd>You blocked this person</dd></div> : null}
      </dl>
      {info.isGroup ? (
        <>
          <p className="lc-section">{info.members.length} people</p>
          <ul className="lc-people">{info.members.map((m) => <li key={m.userId}><strong>{m.displayName}</strong>{m.role !== "MEMBER" ? <span className="lc-tag">{m.role === "OWNER" ? "Owner" : "Admin"}</span> : null}</li>)}</ul>
        </>
      ) : null}
    </Dialog>
  );
}

export const DISAPPEAR_OPTIONS: Array<{ seconds: 86400 | 604800 | 2419200 | null; label: string }> = [
  { seconds: null, label: "Off" }, { seconds: 86400, label: "24 hours" }, { seconds: 604800, label: "7 days" }, { seconds: 2419200, label: "4 weeks" }
];
export const disappearLabel = (seconds: number | null) => DISAPPEAR_OPTIONS.find((o) => o.seconds === seconds)?.label ?? "Off";

export function DisappearingDialog({ api, info, onClose, onChanged }: { api: ChatApi; info: ChatControlsInfo; onClose: () => void; onChanged: () => void }) {
  const [value, setValue] = useState(info.disappearAfterSeconds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await api.setDisappearing(info.conversationId, value as 86400 | 604800 | 2419200 | null); onChanged(); onClose(); } catch { setError("The setting could not be saved."); setBusy(false); }
  };
  return (
    <Dialog title="Disappearing messages" onClose={onClose}>
      <p className="lc-dialog-note">New messages in this chat will disappear after the time you choose. It applies to everyone in the chat, and not to messages already sent.</p>
      <div role="radiogroup" aria-label="Disappear after" className="lc-radios">
        {DISAPPEAR_OPTIONS.map((o) => (
          <label key={String(o.seconds)} className="lc-check"><input type="radio" name="disappear" checked={value === o.seconds} onChange={() => setValue(o.seconds)} />{o.label}</label>
        ))}
      </div>
      {error ? <p className="lc-dialog-note" role="alert" data-warn>{error}</p> : null}
      <div className="lc-dialog-actions">
        <button type="button" className="lc-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="lc-btn lc-btn-primary" disabled={busy || value === info.disappearAfterSeconds} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Dialog>
  );
}

const CATEGORIES: Array<{ id: ReportCategory; label: string }> = [
  { id: "HARASSMENT", label: "Harassment" }, { id: "SCAM", label: "Scam or fraud" }, { id: "THREATS", label: "Threats" }, { id: "IMPERSONATION", label: "Pretending to be someone" },
  { id: "SEXUAL_CONTENT", label: "Sexual content" }, { id: "HATE", label: "Hate" }, { id: "MINOR_SAFETY", label: "A child's safety" }, { id: "OTHER", label: "Something else" }
];

export function ReportDialog({ api, info, onClose, onDone }: { api: ChatApi; info: ChatControlsInfo; onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState<ReportCategory>("HARASSMENT");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const send = async () => {
    setBusy(true); setError(null);
    try { await api.report(info.conversationId, category, text.trim()); setSent(true); onDone(); } catch { setError("The report could not be sent. Try again."); setBusy(false); }
  };
  if (sent) return <Dialog title="Report sent" onClose={onClose}><p className="lc-dialog-note">Thank you. Our safety team will review it. Messages are end-to-end encrypted, so only what you wrote here is shared.</p><div className="lc-dialog-actions"><button type="button" className="lc-btn lc-btn-primary" onClick={onClose}>Done</button></div></Dialog>;
  return (
    <Dialog title={`Report ${info.title}`} onClose={onClose}>
      <form className="lc-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label htmlFor="lc-report-cat">What is wrong?</label>
        <select id="lc-report-cat" className="lc-select" value={category} onChange={(e) => setCategory(e.target.value as ReportCategory)}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        <label htmlFor="lc-report-text">Tell us what happened</label>
        <textarea id="lc-report-text" className="lc-textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="At least 10 characters" />
        {error ? <p className="lc-dialog-note" role="alert" data-warn>{error}</p> : null}
        <div className="lc-dialog-actions">
          <button type="button" className="lc-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="lc-btn lc-btn-primary" disabled={busy || text.trim().length < 10}>{busy ? "Sending…" : "Send report"}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** A poll: the question and 2 to 5 options. It is sent as the same "decision" message the phone sends. */
export function PollDialog({ chatTitle, onClose, onSend }: { chatTitle: string; onClose: () => void; onSend: (title: string, options: string[]) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = options.map((o) => o.trim()).filter(Boolean);
  const valid = title.trim().length > 0 && clean.length >= 2 && new Set(clean).size === clean.length;
  const send = async () => {
    setBusy(true); setError(null);
    try { await onSend(title.trim(), clean); onClose(); } catch { setError("The poll could not be sent."); setBusy(false); }
  };
  return (
    <Dialog title={`New poll in ${chatTitle}`} onClose={onClose}>
      <form className="lc-form" onSubmit={(e) => { e.preventDefault(); if (valid) void send(); }}>
        <label htmlFor="lc-poll-q">Question</label>
        <input id="lc-poll-q" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
        <label>Options</label>
        {options.map((o, i) => (
          <input key={i} aria-label={`Option ${i + 1}`} value={o} maxLength={100} onChange={(e) => setOptions((all) => all.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`} />
        ))}
        {options.length < 5 ? <button type="button" className="lc-btn" onClick={() => setOptions((all) => [...all, ""])}>Add option</button> : null}
        {clean.length >= 2 && new Set(clean).size !== clean.length ? <p className="lc-dialog-note" data-warn>Each option must be different.</p> : null}
        {error ? <p className="lc-dialog-note" role="alert" data-warn>{error}</p> : null}
        <div className="lc-dialog-actions">
          <button type="button" className="lc-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="lc-btn lc-btn-primary" disabled={!valid || busy}>{busy ? "Sending…" : "Send poll"}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function MessageRequestsDialog({ api, onClose, onChanged }: { api: ChatApi; onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<MessageRequestInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.messageRequests().then(setItems, () => { setItems([]); setError("Could not load requests."); });
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (id: string, action: "ACCEPT" | "DECLINE" | "BLOCK") => {
    setError(null);
    try { await api.resolveMessageRequest(id, action); await load(); onChanged(); } catch { setError("That did not work. Try again."); }
  };
  return (
    <Dialog title="Message requests" onClose={onClose}>
      <p className="lc-dialog-note">People you have not chatted with before who want to message you. Their messages stay hidden until you accept.</p>
      {items === null ? <p className="lc-dialog-note">Loading…</p> : items.length === 0 ? <p className="lc-dialog-note">No message requests.</p> : (
        <ul className="lc-devices">
          {items.map((r) => (
            <li key={r.id}>
              <div><strong>{r.senderDisplayName}</strong><span>{r.mutualContacts > 0 ? `${r.mutualContacts} mutual contact${r.mutualContacts === 1 ? "" : "s"}` : "No mutual contacts"}{r.riskLevel && r.riskLevel !== "LOW" ? ` · ${r.riskLevel.toLowerCase()} risk` : ""}</span></div>
              <button type="button" className="lc-btn lc-btn-primary" onClick={() => void act(r.id, "ACCEPT")}>Accept</button>
              <button type="button" className="lc-btn" onClick={() => void act(r.id, "DECLINE")}>Decline</button>
              <button type="button" className="lc-btn" onClick={() => void act(r.id, "BLOCK")}>Block</button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="lc-dialog-note" role="alert" data-warn>{error}</p> : null}
    </Dialog>
  );
}

export function BlockedDialog({ api, onClose, onChanged }: { api: ChatApi; onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<BlockedPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.blockedPeople().then(setItems, () => { setItems([]); setError("Could not load blocked people."); });
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const unblock = async (id: string) => {
    setError(null);
    try { await api.unblockUser(id); await load(); onChanged(); } catch (cause) { setError(cause instanceof ChatApiError && cause.code === "NETWORK" ? "No connection." : "Could not unblock. Try again."); }
  };
  return (
    <Dialog title="Blocked people" onClose={onClose}>
      {items === null ? <p className="lc-dialog-note">Loading…</p> : items.length === 0 ? <p className="lc-dialog-note">You have not blocked anyone.</p> : (
        <ul className="lc-devices">
          {items.map((p) => (
            <li key={p.userId}><div><strong>{p.displayName}</strong><span>Blocked {since(p.blockedAt)}</span></div><button type="button" className="lc-btn" onClick={() => void unblock(p.userId)}>Unblock</button></li>
          ))}
        </ul>
      )}
      {error ? <p className="lc-dialog-note" role="alert" data-warn>{error}</p> : null}
    </Dialog>
  );
}

function Row({ icon, title, note, status, onClick }: { icon: ReactNode; title: string; note: string; status: "ready" | "phone" | "chat"; onClick?: () => void }) {
  const live = status === "ready";
  return (
    <li>
      <button type="button" className="lc-menu-row" data-state={status} aria-disabled={!live} title={live ? undefined : status === "chat" ? "Open a chat first" : "Open Linqa on your phone to use this"} onClick={live ? onClick : undefined}>
        <span className="lc-menu-ico">{icon}</span>
        <span className="lc-menu-text"><strong>{title}</strong><span>{note}</span></span>
        <span className="lc-menu-badge" data-state={status}>{live ? "Available" : status === "chat" ? "Open a chat" : "On your phone"}</span>
      </button>
    </li>
  );
}

/** Everything Linqa does, and where it works. What a computer can do opens here; the rest says so plainly instead of pretending. */
export function LinqaMenuPanel(props: {
  activeTitle: string | null; requestCount: number; canPoll: boolean;onFeature:(mode:DesktopFeature)=>void;
  onPoll: () => void; onRequests: () => void; onBlocked: () => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  return (
    <aside className="lc-panel" aria-label="Linqa Menu">
      <header><h2>Linqa Menu</h2><button type="button" className="lc-icon" aria-label="Close Linqa Menu" onClick={props.onClose}><CloseIcon size={20} /></button></header>
      <section>
        <p className="lc-dialog-note">{props.activeTitle?`In ${props.activeTitle}`:"Open a chat to use its tools. Vault is available without a chat."}</p>
        <h3>Calls</h3>
        <ul className="lc-menu-list">
          <Row icon={<PhoneIcon size={20} />} title="Voice call" note="Call from this computer" status={props.activeTitle?"ready":"chat"} onClick={()=>props.onFeature('voice-call')} />
          <Row icon={<VideoIcon size={20}/>} title="Video call" note="Call with your camera" status={props.activeTitle?"ready":"chat"} onClick={()=>props.onFeature('video-call')}/>
          <Row icon={<VideoIcon size={20} />} title="Call recording and transcription" note="Record your microphone; use local transcription" status={props.activeTitle?"ready":"chat"} onClick={()=>props.onFeature('recording')} />
        </ul>
      </section>
      <section>
        <h3>Media</h3>
        <ul className="lc-menu-list">
          <Row icon={<CameraIcon size={20} />} title="Photos and videos" note="Send encrypted photos and videos" status={props.activeTitle?"ready":"chat"} onClick={()=>props.onFeature('photos')} />
          <Row icon={<MicIcon size={20} />} title="Voice messages" note="Record and send from your microphone" status={props.activeTitle?"ready":"chat"} onClick={()=>props.onFeature('voice')} />
          <Row icon={<PaperclipIcon size={20} />} title="Attachments" note="Send an encrypted file" status={props.activeTitle?"ready":"chat"} onClick={()=>props.onFeature('attachments')} />
          <Row icon={<PaperclipIcon size={20}/>} title="GIFs" note="Send an animated GIF" status={props.activeTitle?"ready":"chat"} onClick={()=>props.onFeature('gif')}/>
          <Row icon={<UserPlusIcon size={20}/>} title="Location card" note="Share a location or contact in your chat" status={props.activeTitle?"ready":"chat"} onClick={()=>props.onFeature('location')}/>
          <Row icon={<UserPlusIcon size={20}/>} title="Contact card" note="Share contact details" status={props.activeTitle?"ready":"chat"} onClick={()=>props.onFeature('contact')}/>
        </ul>
      </section>
      <section>
        <h3>Collaborate</h3>
        <ul className="lc-menu-list">
          <Row icon={<ShieldIcon size={20} />} title="Whiteboard and screen share" note="Open the collaborative call tools" status={props.activeTitle?"ready":"chat"} onClick={()=>props.onFeature('whiteboard')} />
          <Row icon={<UserPlusIcon size={20} />} title="Polls" note={props.canPoll && props.activeTitle ? `Ask ${props.activeTitle} to vote` : "Open a chat first"} status={props.canPoll ? "ready" : "phone"} onClick={props.onPoll} />
          <Row icon={<ShieldIcon size={20} />} title="Events" note="Create a shared event or meeting" status={props.activeTitle?"ready":"chat"} onClick={()=>props.onFeature('events')} />
          <Row icon={<VideoIcon size={20}/>} title="Meetings" note="Schedule a meeting, then join from its card" status={props.activeTitle?"ready":"chat"} onClick={()=>props.onFeature('meetings')}/>
          <Row icon={<LockSolidIcon size={20}/>} title="Vault" note="Save and open encrypted files" status="ready" onClick={()=>props.onFeature('vault')}/>
          <Row icon={<ShieldIcon size={20}/>} title="Linqa AI" note="Local text tools and image generation" status={props.activeTitle?"ready":"chat"} onClick={()=>props.onFeature('ai')}/>
        </ul>
      </section>
      <section>
        <h3>Privacy and safety</h3>
        <ul className="lc-menu-list">
          <Row icon={<UserPlusIcon size={20} />} title="Message requests" note={props.requestCount > 0 ? `${props.requestCount} waiting` : "No one is waiting"} status="ready" onClick={props.onRequests} />
          <Row icon={<ShieldIcon size={20} />} title="Blocked people" note="See and unblock" status="ready" onClick={props.onBlocked} />
          <Row icon={<LockSolidIcon size={20} />} title="Mute, disappearing messages, report, block" note="In the menu at the top of each chat" status="ready" />
        </ul>
      </section>
    </aside>
  );
}
