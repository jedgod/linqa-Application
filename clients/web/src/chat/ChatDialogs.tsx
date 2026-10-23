import { t, i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChatApiError, type ChatApi, type FoundContact, type LinkedDeviceInfo } from "./chatApi";
import { CloseIcon, LaptopIcon, LockIcon, PhoneIcon } from "./ChatIcons";
import { getComputerName, setComputerName } from "./linkedSession";
import { FAILURE_TEXT, type HistorySyncState } from "./historySync";

/** A centred dialog. Escape or a click outside closes it, and focus starts inside it. */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useTranslation();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    box.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lc-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lc-dialog" data-wide={wide ? "true" : undefined} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box}>
        <header className="lc-dialog-head"><h2>{title}</h2><button type="button" className="lc-icon" aria-label={t("Close")} onClick={onClose}><CloseIcon size={22} /></button></header>
        <div className="lc-dialog-body">{children}</div>
      </div>
    </div>
  );
}

/** Start a chat with someone by phone number. The server looks the number up; nothing is sent until you write a message. */
export function NewChatDialog({ api, onClose, onOpened }: { api: ChatApi; onClose: () => void; onOpened: (conversationId: string) => void }) {
  useTranslation();
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<FoundContact | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const look = async () => {
    const value = phone.trim();
    if (!value) return;
    setBusy(true); setError(null); setFound(undefined);
    try { setFound(await api.findContact(value)); }
    catch (cause) {
      const code = cause instanceof ChatApiError ? cause.code : "";
      setError(code === "INVALID_PHONE_NUMBER" ? "Enter the number with its country code, like +1 240 555 0100." : code === "RATE_LIMITED" ? "Too many lookups. Wait a moment." : code === "NETWORK" ? "No connection to Linqa." : "That number could not be looked up.");
    } finally { setBusy(false); }
  };
  const open = async () => {
    if (!found) return;
    setBusy(true); setError(null);
    try { onOpened(await api.openDirect(found.id)); onClose(); }
    catch { setError("Could not open that chat. They may not accept messages from you."); setBusy(false); }
  };

  return (
    <Dialog title={t("New chat")} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void look(); }} className="lc-form">
        <label htmlFor="lc-phone">Phone number</label>
        <input id="lc-phone" value={phone} onChange={(e) => { setPhone(e.target.value); setFound(undefined); }} placeholder="+1 240 555 0100" inputMode="tel" autoComplete="off" autoFocus />
        <button type="submit" className="lc-btn lc-btn-primary" disabled={busy || !phone.trim()}>{busy && found === undefined ? "Looking…" : "Find"}</button>
      </form>
      {found === null ? <p className="lc-dialog-note">No one on Linqa has that number, or they cannot be messaged.</p> : null}
      {found ? (
        <div className="lc-found">
          <span className="lc-avatar" aria-hidden>{found.displayName.slice(0, 1).toUpperCase()}</span>
          <strong>{found.displayName}</strong>
          <button type="button" className="lc-btn lc-btn-primary" onClick={() => void open()} disabled={busy}>Start chat</button>
        </div>
      ) : null}
      {error ? <p className="lc-dialog-note" role="alert">{error}</p> : null}
    </Dialog>
  );
}

const platformName = (platform: string) => (platform === "WEB" ? "Web browser" : platform === "DESKTOP" ? "Desktop app" : platform === "ANDROID" ? "Android phone" : platform === "IOS" ? "iPhone" : platform);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/** Everything signed in to this account. A computer can remove other computers; only a phone can remove a phone. */
export function LinkedDevicesDialog({ api, onClose }: { api: ChatApi; onClose: () => void }) {
  useTranslation();
  const [devices, setDevices] = useState<LinkedDeviceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => { try { setDevices(await api.devices()); setError(null); } catch { setError("Could not load your devices."); } };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const unlink = async (d: LinkedDeviceInfo) => {
    if (!window.confirm(`Unlink "${d.deviceName}"? It will be signed out and stop receiving your messages.`)) return;
    try { await api.unlinkDevice(d.id); await load(); } catch { setError("Could not unlink that device."); }
  };
  const isComputer = (p: string) => p === "WEB" || p === "DESKTOP";

  return (
    <Dialog title={t("Linked devices")} onClose={onClose} wide>
      <p className="lc-dialog-note">To link another computer, open Linqa on your phone: <strong>Settings &gt; Linked devices &gt; Scan QR code</strong>.</p>
      {error ? <p className="lc-dialog-note" role="alert">{error}</p> : null}
      {devices === null && !error ? <p className="lc-dialog-note">Loading…</p> : null}
      <ul className="lc-devices">
        {(devices ?? []).map((d) => (
          <li key={d.id}>
            {isComputer(d.platform) ? <LaptopIcon size={26} /> : <PhoneIcon size={26} />}
            <div><strong>{d.deviceName}{d.current ? " · This computer" : ""}</strong><span>{platformName(d.platform)}{d.registeredAt ? ` · Linked ${when(d.registeredAt)}` : ""}</span></div>
            {!d.current && isComputer(d.platform) ? <button type="button" className="lc-btn" onClick={() => void unlink(d)}>Unlink</button> : null}
            {!d.current && !isComputer(d.platform) ? <span className="lc-tag">Phone</span> : null}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export function SettingsDialog({ defaultName, enterToSend, onEnterToSend, onSaved, onSignOut, onClose }: { defaultName: string; enterToSend: boolean; onEnterToSend: (on: boolean) => void; onSaved: (name: string) => void; onSignOut: () => void; onClose: () => void }) {
  useTranslation();
  const [name, setName] = useState(getComputerName() || defaultName);
  return (
    <Dialog title={t("Settings")} onClose={onClose}>
      <form className="lc-form" onSubmit={(e) => { e.preventDefault(); setComputerName(name); onSaved(name.trim() || defaultName); onClose(); }}>
        <label htmlFor="lc-computer-name">{t("Name of this computer")}</label>
        <input id="lc-computer-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <button type="submit" className="lc-btn lc-btn-primary">{t("Save")}</button>
      </form>
      <p className="lc-dialog-note">The name is shown at the top of your chats on this computer.</p>
      <hr className="lc-rule" />
      <label className="lc-check"><input type="checkbox" checked={enterToSend} onChange={(e) => onEnterToSend(e.target.checked)} />{t("Enter to send")}</label>
      <p className="lc-dialog-note">{enterToSend ? "Enter sends the message. Shift+Enter starts a new line." : "Enter starts a new line. Use the Send button, or Ctrl+Enter, to send."}</p>
      <hr className="lc-rule" />
      <button type="button" className="lc-btn" onClick={onSignOut}>{t("Sign out of this computer")}</button>
      <p className="lc-dialog-note">{t("Your chats stay on your phone. You can link this computer again any time.")}</p>
    </Dialog>
  );
}

const STEPS = ["Waiting for phone approval", "Transferring", "Opening messages", "Complete"] as const;
function stepIndex(state: HistorySyncState): number {
  switch (state.step) {
    case "requesting": case "waiting": return 0;
    case "transferring": return 1;
    case "opening": return 2;
    case "complete": return 3;
    default: return -1;
  }
}

export function HistoryDialog({ state, onStart, onCancel, onClose }: { state: HistorySyncState; onStart: () => void; onCancel: () => void; onClose: () => void }) {
  useTranslation();
  const running = ["requesting", "waiting", "transferring", "opening"].includes(state.step);
  const at = stepIndex(state);
  const detail =
    state.step === "waiting" && !state.phoneOnline ? "Your phone appears to be offline. Open Linqa on your phone and this will continue."
    : state.step === "waiting" ? "Open Linqa on your phone and choose Send."
    : state.step === "transferring" ? (state.total ? `Your phone is sending ${state.done} of ${state.total} parts.` : "Your phone is preparing the messages.")
    : state.step === "opening" ? `Opening part ${Math.min(state.done + 1, state.total)} of ${state.total} on this computer.`
    : state.step === "complete" ? (state.messages > 0 ? `${state.messages} older messages are now on this computer.` : "Nothing older was left to bring over.")
    : state.step === "failed" ? FAILURE_TEXT[state.reason]
    : "";
  return (
    <Dialog title="Older history" onClose={onClose}>
      {state.step === "idle" || state.step === "failed" ? (
        <div className="lc-history">
          <span className="lc-history-icon"><LockIcon size={30} /></span>
          <div>
            <p>Each message is sealed for the devices that were linked when it was sent, so this computer cannot read earlier ones by itself. Your phone can send them over, sealed for this computer only. You approve it on your phone.</p>
            {state.step === "failed" ? <p role="alert"><strong>{detail}</strong></p> : null}
          </div>
        </div>
      ) : (
        <>
          <ol className="lc-steps" aria-label="History transfer progress">
            {STEPS.map((label, i) => (
              <li key={label} data-state={state.step === "complete" || i < at ? "done" : i === at ? "now" : "next"}>
                <i aria-hidden>{state.step === "complete" || i < at ? "✓" : i + 1}</i>{label}
              </li>
            ))}
          </ol>
          {state.step === "transferring" && state.total ? <progress className="lc-progress" max={state.total} value={state.done} aria-label="Transfer progress" /> : null}
          {state.step === "opening" ? <progress className="lc-progress" max={state.total} value={state.done} aria-label="Opening progress" /> : null}
          <p className="lc-dialog-note" role="status" data-warn={state.step === "waiting" && !state.phoneOnline}>{detail}</p>
        </>
      )}
      <div className="lc-dialog-actions">
        {running ? <button type="button" className="lc-btn" onClick={onCancel}>{t("Cancel")}</button> : null}
        {state.step === "idle" ? <button type="button" className="lc-btn lc-btn-primary" onClick={onStart}>Ask my phone</button> : null}
        {state.step === "failed" ? <button type="button" className="lc-btn lc-btn-primary" onClick={onStart}>{t("Try again")}</button> : null}
        {state.step === "complete" || state.step === "failed" || state.step === "idle" ? <button type="button" className="lc-btn" onClick={onClose}>{state.step === "complete" ? "Done" : "Close"}</button> : null}
      </div>
    </Dialog>
  );
}

const EMOJI = ["😀", "😂", "😍", "🥰", "😊", "😉", "😎", "🤔", "😢", "😭", "😡", "🙏", "👍", "👎", "👏", "🙌", "💪", "🔥", "🎉", "❤️", "💜", "💯", "✅", "🌟", "☀️", "🌙", "🍕", "☕", "🎶", "👋"];
export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lc-emoji" role="dialog" aria-label="Emoji">
      {EMOJI.map((e) => <button key={e} type="button" onClick={() => onPick(e)} aria-label={e}>{e}</button>)}
    </div>
  );
}
