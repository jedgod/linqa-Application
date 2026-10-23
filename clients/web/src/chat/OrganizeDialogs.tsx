import { LanguagePicker } from '../i18n/LanguagePicker';
import { t } from '../i18n';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from "react";
import type { ChatApi, ChatListInfo, ListColor } from "./chatApi";
import { ChatApiError } from "./chatApi";
import { Dialog } from "./ChatDialogs";
import { CloseIcon, GearIcon } from "./ChatIcons";
import { getComputerName, setComputerName } from "./linkedSession";

export interface Contact { userId: string; name: string }
const COLORS: ListColor[] = ["violet", "blue", "green", "orange", "red", "teal"];

const reason = (cause: unknown, fallback: string) => {
  const code = cause instanceof ChatApiError ? cause.code : "";
  switch (code) {
    case "LIST_EXISTS": return "You already have a list with that name.";
    case "TOO_MANY_LISTS": return "You have reached the limit of 20 lists.";
    case "INVALID_LIST_NAME": return "Give the list a name of up to 40 characters.";
    case "NOT_A_CONTACT": return "Groups can only include people you already chat with.";
    case "GROUP_FULL": return "That group is full.";
    case "NOT_ALLOWED": return "Only the person who made the group, or an admin, can add people.";
    case "NETWORK": return "No connection. Try again.";
    default: return fallback;
  }
};

export function ListDialog({ api, onClose, onDone }: { api: ChatApi; onClose: () => void; onDone: (list: ChatListInfo) => void }) {
  useTranslation();
  const [name, setName] = useState("");
  const [color, setColor] = useState<ListColor>("violet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError(null);
    try { const made = await api.createList(name.trim(), color); onDone(made); onClose(); }
    catch (cause) { setError(reason(cause, "The list could not be created.")); setBusy(false); }
  };
  return (
    <Dialog title={t("Create a list")} onClose={onClose}>
      <form className="lc-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label htmlFor="lc-list-name">List name</label>
        <input id="lc-list-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Work, Family, …" autoFocus />
        <div className="lc-colors" role="radiogroup" aria-label="Colour">
          {COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} data-color={c} className="lc-swatch" onClick={() => setColor(c)} />)}
        </div>
        {error ? <p className="lc-dialog-note" role="alert" data-warn>{error}</p> : null}
        <p className="lc-dialog-note">A list sorts your chats. Only you see it, and it is the same on your phone.</p>
        <button type="submit" className="lc-btn lc-btn-primary" disabled={!name.trim() || busy}>{busy ? "Creating…" : "Create list"}</button>
      </form>
    </Dialog>
  );
}

export function ManageListsDialog({ api, lists, onClose, onChanged }: { api: ChatApi; lists: ChatListInfo[]; onClose: () => void; onChanged: () => void }) {
  useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rename = async (id: string) => {
    setError(null);
    try { await api.renameList(id, name.trim()); setEditing(null); onChanged(); }
    catch (cause) { setError(reason(cause, "The list could not be renamed.")); }
  };
  const remove = async (list: ChatListInfo) => {
    if (!window.confirm(`Delete the list "${list.name}"? Your chats stay where they are.`)) return;
    setError(null);
    try { await api.deleteList(list.id); onChanged(); } catch (cause) { setError(reason(cause, "The list could not be deleted.")); }
  };
  return (
    <Dialog title={t("Manage lists")} onClose={onClose}>
      {lists.length === 0 ? <p className="lc-dialog-note">You have no lists yet. Use + then Create a list.</p> : (
        <ul className="lc-devices">
          {lists.map((l) => (
            <li key={l.id}>
              <span className="lc-dot" data-color={l.color} aria-hidden />
              {editing === l.id ? (
                <form className="lc-inline-form" onSubmit={(e) => { e.preventDefault(); void rename(l.id); }}>
                  <input aria-label="List name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
                  <button type="submit" className="lc-btn lc-btn-primary" disabled={!name.trim()}>{t("Save")}</button>
                </form>
              ) : (
                <>
                  <div><strong>{l.name}</strong><span>{l.count} {l.count === 1 ? "chat" : "chats"}</span></div>
                  <button type="button" className="lc-btn" onClick={() => { setEditing(l.id); setName(l.name); }}>Rename</button>
                  <button type="button" className="lc-btn" onClick={() => void remove(l)}>{t("Delete")}</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="lc-dialog-note" role="alert" data-warn>{error}</p> : null}
    </Dialog>
  );
}

function PeoplePicker({ contacts, chosen, onToggle }: { contacts: Contact[]; chosen: Set<string>; onToggle: (id: string) => void }) {
  useTranslation();
  if (contacts.length === 0) return <p className="lc-dialog-note">You have no one to add yet. Start a chat with someone first.</p>;
  return (
    <ul className="lc-people" aria-label="People">
      {contacts.map((c) => (
        <li key={c.userId}>
          <label className="lc-check"><input type="checkbox" checked={chosen.has(c.userId)} onChange={() => onToggle(c.userId)} />{c.name}</label>
        </li>
      ))}
    </ul>
  );
}

const toggled = (set: Set<string>, id: string) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; };

export function GroupDialog({ api, contacts, onClose, onCreated }: { api: ChatApi; contacts: Contact[]; onClose: () => void; onCreated: (conversationId: string) => void }) {
  useTranslation();
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!title.trim() || chosen.size === 0 || busy) return;
    setBusy(true); setError(null);
    try { onCreated(await api.createGroup(title.trim(), [...chosen])); onClose(); }
    catch (cause) { setError(reason(cause, "The group could not be created.")); setBusy(false); }
  };
  return (
    <Dialog title={t("Create a group")} onClose={onClose}>
      <form className="lc-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label htmlFor="lc-group-name">Group name</label>
        <input id="lc-group-name" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} autoFocus />
        <label>Add people (up to 4)</label>
        <PeoplePicker contacts={contacts} chosen={chosen} onToggle={(id) => setChosen((s) => (s.has(id) || s.size < 4 ? toggled(s, id) : s))} />
        {error ? <p className="lc-dialog-note" role="alert" data-warn>{error}</p> : null}
        <p className="lc-dialog-note">A group is a shared conversation. Everyone in it can read its messages.</p>
        <button type="submit" className="lc-btn lc-btn-primary" disabled={!title.trim() || chosen.size === 0 || busy}>{busy ? "Creating…" : "Create group"}</button>
      </form>
    </Dialog>
  );
}

export function AddPeopleDialog({ api, groupId, groupName, existing, contacts, onClose, onDone }: { api: ChatApi; groupId: string; groupName: string; existing: string[]; contacts: Contact[]; onClose: () => void; onDone: () => void }) {
  useTranslation();
  const candidates = contacts.filter((c) => !existing.includes(c.userId));
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (chosen.size === 0 || busy) return;
    setBusy(true); setError(null);
    try { await api.addGroupMembers(groupId, [...chosen]); onDone(); onClose(); }
    catch (cause) { setError(reason(cause, "People could not be added.")); setBusy(false); }
  };
  return (
    <Dialog title={`Add people to ${groupName}`} onClose={onClose}>
      <form className="lc-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <PeoplePicker contacts={candidates} chosen={chosen} onToggle={(id) => setChosen((s) => toggled(s, id))} />
        {error ? <p className="lc-dialog-note" role="alert" data-warn>{error}</p> : null}
        <p className="lc-dialog-note">New people see messages sent after they join.</p>
        <button type="submit" className="lc-btn lc-btn-primary" disabled={chosen.size === 0 || busy}>{busy ? "Adding…" : "Add people"}</button>
      </form>
    </Dialog>
  );
}

/** Settings as a panel beside the chat, as in the design. */
export function SettingsPanel(props: {
  defaultName: string; enterToSend: boolean; onEnterToSend: (on: boolean) => void; onSaved: (name: string) => void;
  notifications: boolean; notificationsBlocked: boolean; onNotifications: (on: boolean) => void;
  favorites: number; archived: number; lists: number;
  onManageLists: () => void; onFavorites: () => void; onArchived: () => void; onSignOut: () => void; onClose: () => void;
}) {
  useTranslation();
  const [name, setName] = useState(getComputerName() || props.defaultName);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  return (
    <aside className="lc-panel" aria-label={t("Settings")}>
      <LanguagePicker />
      <header><h2>{t("Settings")}</h2><button type="button" className="lc-icon" aria-label={t("Close settings")} onClick={props.onClose}><CloseIcon size={20} /></button></header>
      <section>
        <h3>{t("This computer")}</h3>
        <p className="lc-dialog-note">{t("This name helps you recognize this device in your linked devices.")}</p>
        <form className="lc-inline-form" onSubmit={(e) => { e.preventDefault(); setComputerName(name); props.onSaved(name.trim() || props.defaultName); setSaved(true); setTimeout(() => setSaved(false), 2000); }}>
          <input aria-label={t("Name of this computer")} value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} maxLength={60} />
          <button type="submit" className="lc-btn lc-btn-primary">{saved ? t("Saved") : t("Save")}</button>
        </form>
      </section>
      <section>
        <h3>{t("Chat organization")}</h3>
        <ul className="lc-shortcuts">
          <li><button type="button" onClick={props.onManageLists}><GearIcon size={18} />{t("Manage chat lists")}<span>{props.lists}</span></button></li>
          <li><button type="button" onClick={props.onFavorites}><span aria-hidden className="lc-star">★</span>{t("Favorites")}<span>{props.favorites}</span></button></li>
          <li><button type="button" onClick={props.onArchived}><span aria-hidden>▣</span>{t("Archived chats")}<span>{props.archived}</span></button></li>
        </ul>
        <p className="lc-dialog-note">{t("Lists organize chats. Groups are shared conversations.")}</p>
      </section>
      <section>
        <h3>{t("Messaging")}</h3>
        <label className="lc-check"><input type="checkbox" checked={props.enterToSend} onChange={(e) => props.onEnterToSend(e.target.checked)} />{t("Enter to send")}</label>
        <p className="lc-dialog-note">{props.enterToSend ? t("Shift+Enter starts a new line.") : t("Enter starts a new line. Use the Send button, or Ctrl+Enter, to send.")}</p>
        <label className="lc-switch">
          <span>{t("Desktop notifications")}</span>
          <input type="checkbox" role="switch" checked={props.notifications} disabled={props.notificationsBlocked} onChange={(e) => props.onNotifications(e.target.checked)} />
        </label>
        {props.notificationsBlocked ? <p className="lc-dialog-note">{t("Notifications are blocked in this browser. Allow them in the site settings to turn this on.")}</p> : null}
      </section>
      <section>
        <button type="button" className="lc-btn" onClick={props.onSignOut}>{t("Sign out of this computer")}</button>
        <p className="lc-dialog-note">{t("Your chats stay on your phone. You can link this computer again any time.")}</p>
      </section>
    </aside>
  );
}
