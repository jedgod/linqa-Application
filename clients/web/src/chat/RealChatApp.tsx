import { t, i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { ForwardBatch } from "../../../mobile/services/forward-batch";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { describeBrowser } from "../auth/deviceLinkClient";
import { describeBody, type ChatListInfo, type InboxChat, type InboxCounts, type ServerMessage } from "./chatApi";
import { EmojiPicker, HistoryDialog, LinkedDevicesDialog, NewChatDialog } from "./ChatDialogs";
import { BlockedDialog, ConfirmDialog, ContactInfoDialog, DisappearingDialog, LinqaMenuPanel, MessageRequestsDialog, PollDialog, ReportDialog } from "./ControlsDialogs";
import type { ChatControlsInfo } from "./chatApi";
import { AddPeopleDialog, GroupDialog, ListDialog, ManageListsDialog, SettingsPanel, type Contact } from "./OrganizeDialogs";
import {
  CopyIcon, ForwardIcon, ReplyIcon, BanIcon, BellOffIcon, CheckSquareIcon, FlagIcon, GridIcon, InfoIcon, TimerIcon, TrashIcon,
  ArchiveIcon, CameraIcon, CheckIcon, ChevronDownIcon, CloseIcon, DotsIcon, FolderIcon, GearIcon, LaptopIcon, LinqaMark, ListIcon, LockSolidIcon, MicIcon, PaperclipIcon, PhoneIcon,
  PlusIcon, SearchIcon, SendPlaneIcon, ShieldIcon, SignOutIcon, SmileIcon, StarIcon, UserPlusIcon, UsersIcon, VideoIcon,
} from "./ChatIcons";
import { useHistorySync } from "./historySync";
import { ForwardDialog } from "./ForwardDialog";
import { HistoryStore } from "./historyStore";
import { getComputerName } from "./linkedSession";
import { SecureChatError } from "./secureMessaging";
import { useLinkedChat, type ChatRuntime } from "./useLinkedChat";
import {DesktopCallHost,useDesktopCalls} from '../calls/DesktopCallHost';
import {DesktopFeatureDialog,DesktopVaultDialog,DesktopMessage,FeatureThreadContext,type DesktopFeature} from './features/DesktopFeatures';
import './features/desktop-features.css';
import "./chat.css";

type Ready = Extract<ChatRuntime, { status: "ready" }>;
type Poll = { title: string; options: string[]; votes: Record<string, number> };
type ReplyRef = { id: string; senderId: string; text: string };
type Shown = { id: string; mine: boolean; text: string; at: string; state?: "sending" | "failed"; sealed?: boolean; raw?: string; sender?: string; poll?: Poll; reply?: ReplyRef; forwarded?: boolean };
type ControlKind = "contact" | "disappearing" | "report" | "clear" | "delete" | "block";
type ThreadHandle = { sendPoll: (title: string, options: string[]) => Promise<void>;openFeature:(mode:DesktopFeature)=>void };
type Item = { kind: "message"; message: Shown } | { kind: "sealed-run"; key: string; label: string };
type DialogName = null | "new" | "devices" | "history" | "list" | "group" | "addPeople" | "manageLists" | "poll" | "requests" | "blocked";
type View = { kind: "all" | "unread" | "favorites" | "groups" | "archived" } | { kind: "list"; listId: string };

const INBOX_POLL_MS = 5000;
const THREAD_POLL_MS = 4000;
const DEVICES_POLL_MS = 60_000;
const PREVIEW_LIMIT = 25;
const PREVIEW_SCAN = 10;
const UNAVAILABLE_PREVIEW = "Older history unavailable";
const TOAST_MS = 4500;
const NOTIFY_KEY = "linqa.web.notifications.v1";
const SIDE_KEY = "linqa.web.sidebar-width.v1";
const ENTER_KEY = "linqa.web.enter-to-send.v1";
const SYNCED_KEY = "linqa.web.history-synced.v1";
const SIDE_DEFAULT = 320;
const SIDE_MIN = 240;
const SIDE_MAX = 520;

const readNumber = (key: string, fallback: number) => { try { const v = Number(localStorage.getItem(key)); return Number.isFinite(v) && v > 0 ? v : fallback; } catch { return fallback; } };
const readSynced = () => { try { return localStorage.getItem(SYNCED_KEY) === "yes"; } catch { return false; } };
const readEnterToSend = () => { try { return localStorage.getItem(ENTER_KEY) !== "off"; } catch { return true; } };

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const timeLabel = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return d.toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return sameDay(d, yesterday) ? t("Yesterday") : d.toLocaleDateString(i18n.language, { month: "short", day: "numeric" });
};
const clock = (iso: string | Date) => new Date(iso).toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit" });
const short = (d: Date) => d.toLocaleDateString(i18n.language, { month: "short", day: "numeric" });
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";

/** "Oct 8" for one day, "Oct 8–9" within a month, "Oct 30–Nov 2" across months. */
function rangeLabel(first: string, last: string): string {
  const a = new Date(first);
  const b = new Date(last);
  if (sameDay(a, b)) return short(a);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  return `${short(a)}–${sameMonth ? b.getDate() : short(b)}`;
}

/** Each run of messages that could not be opened on this computer becomes one marker; everything else stays a bubble. */
function toItems(rows: Shown[]): Item[] {
  const items: Item[] = [];
  let run: Shown[] = [];
  const close = () => {
    if (run.length) { items.push({ kind: "sealed-run", key: run[0]!.id, label: rangeLabel(run[0]!.at, run[run.length - 1]!.at) }); run = []; }
  };
  for (const row of rows) {
    if (row.sealed) run.push(row);
    else { close(); items.push({ kind: "message", message: row }); }
  }
  close();
  return items;
}

const parseBody = (raw?: string): Record<string, unknown> | null => {
  if (!raw || !raw.trim().startsWith("{")) return null;
  try { const v = JSON.parse(raw) as unknown; return v && typeof v === "object" ? (v as Record<string, unknown>) : null; } catch { return null; }
};

/** A poll is a "decision" message; votes are separate messages that point at it and are folded into its card, as on the phone. */
function foldPolls(rows: Shown[]): Shown[] {
  const boards = new Map<string, Shown>();
  const out: Shown[] = [];
  for (const row of rows) {
    const body = row.sealed ? null : parseBody(row.raw);
    if (!body) { out.push(row); continue; }
    if (body.type === "decision" && typeof body.title === "string" && Array.isArray(body.options) && body.options.length >= 2) {
      const card: Shown = { ...row, text: `Poll: ${body.title}`, poll: { title: body.title, options: body.options.map(String), votes: {} } };
      boards.set(row.id, card);
      out.push(card);
    } else if (body.type === "text" && typeof body.text === "string") {
      const r = body.reply as Record<string, unknown> | undefined;
      const reply = r && typeof r.id === "string" && typeof r.senderId === "string" && typeof r.text === "string" ? { id: r.id.slice(0, 80), senderId: r.senderId.slice(0, 80), text: r.text.slice(0, 200) } : undefined;
      out.push({ ...row, ...(reply ? { reply } : {}), ...(body.forwarded === true ? { forwarded: true } : {}) });
    } else if (body.type === "vote") {
      const board = boards.get(String(body.boardId));
      const choice = Number(body.choice);
      if (board?.poll && Number.isInteger(choice) && choice >= 0 && choice < board.poll.options.length) board.poll.votes[row.sender ?? ""] = choice;
    } else out.push(row);
  }
  return out;
}

function Avatar({ chat, size = "md" }: { chat: Pick<InboxChat, "title" | "initials" | "isGroup">; size?: "md" | "lg" }) {
  useTranslation();
  const hue = Array.from(chat.title).reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="lc-avatar" data-size={size} data-group={chat.isGroup || undefined} style={chat.isGroup ? undefined : { background: `hsl(${hue} 55% 52%)` }} aria-hidden>
      {chat.isGroup ? <UsersIcon size={size === "lg" ? 24 : 22} /> : (chat.initials || initialsOf(chat.title)).slice(0, 2)}
    </span>
  );
}

/** Linqa on a computer: the chats of the account this browser was linked to, opened and sent with this computer's own keys. */
export function RealChatApp({ onSignedOut }: { onSignedOut: () => void }) {
  useTranslation();
  const runtime = useLinkedChat();
  useEffect(() => { if (runtime.status === "signed-out") onSignedOut(); }, [runtime.status, onSignedOut]);

  if (runtime.status === "loading") return <main className="lc-page"><div className="lc-center"><p>{t("Opening your chats…")}</p></div></main>;
  if (runtime.status === "error") return <main className="lc-page"><div className="lc-center"><p role="alert">Linqa could not start: {runtime.message}</p></div></main>;
  if (runtime.status === "signed-out") return null;
  return <DesktopCallHost runtime={runtime}><ChatShell runtime={runtime}/></DesktopCallHost>;
}

function ChatShell({ runtime }: { runtime: Ready }) {
  useTranslation();
  const { api, messaging, peers, userId, signOut } = runtime;
  const store = useMemo(() => new HistoryStore(), []);
  const [chats, setChats] = useState<InboxChat[]>([]);
  const [archivedChats, setArchivedChats] = useState<InboxChat[]>([]);
  const [counts, setCounts] = useState<InboxCounts>({ all: 0, unread: 0, groups: 0, favorites: 0, archived: 0 });
  const [lists, setLists] = useState<ChatListInfo[]>([]);
  const [view, setView] = useState<View>({ kind: "all" });
  const [listsOpen, setListsOpen] = useState(true);
  const [plusMenu, setPlusMenu] = useState(false);
  const [panel, setPanel] = useState<null | "settings" | "linqa">(null);
  const [ctl, setCtl] = useState<{ kind: ControlKind; info: ChatControlsInfo } | null>(null);
  const [requestCount, setRequestCount] = useState(0);
  const threadHandle = useRef<ThreadHandle | null>(null);
  const [forwardText, setForwardText] = useState<string | null>(null);
  const forwardBatch=useRef<ForwardBatch<string>|null>(null);
  const beginForward=(text:string)=>{forwardBatch.current=null;setForwardText(text);};
  const [vaultOpen,setVaultOpen]=useState(false);
  const autoOpened = useRef(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [query, setQuery] = useState("");
  const [myName, setMyName] = useState("");
  const [phoneLinked, setPhoneLinked] = useState<boolean | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [sideWidth, setSideWidth] = useState(() => Math.min(SIDE_MAX, Math.max(SIDE_MIN, readNumber(SIDE_KEY, SIDE_DEFAULT))));
  const [enterToSend, setEnterToSendState] = useState(readEnterToSend);
  const [synced, setSynced] = useState(readSynced);
  const [notifications, setNotificationsState] = useState(() => { try { return localStorage.getItem(NOTIFY_KEY) === "on" && typeof Notification !== "undefined" && Notification.permission === "granted"; } catch { return false; } });
  const [organizeNote, setOrganizeNote] = useState<string | null>(null);
  const defaultName = useMemo(() => describeBrowser(), []);
  const [computerName, setComputerNameState] = useState(() => getComputerName() || defaultName);
  const previewCache = useRef(new Map<string, string>());
  const unreadSeen = useRef<number | null>(null);
  const polls = useRef(0);

  const sync = useHistorySync({
    api, messaging, store, userId,
    onImported: () => { previewCache.current.clear(); setHistoryVersion((v) => v + 1); setSynced(true); try { localStorage.setItem(SYNCED_KEY, "yes"); } catch { /* shown again next time */ } }
  });

  const doSignOut = useCallback(async () => { await sync.cancel().catch(() => undefined); await store.clear().catch(() => undefined); await signOut(); }, [signOut, store, sync]);
  const confirmSignOut = useCallback(() => {
    if (window.confirm("Sign out on this computer? Your chats stay on your phone. You can link this computer again any time.")) void doSignOut();
  }, [doSignOut]);

  const setEnterToSend = useCallback((on: boolean) => {
    setEnterToSendState(on);
    try { localStorage.setItem(ENTER_KEY, on ? "on" : "off"); } catch { /* the choice just lasts until the page closes */ }
  }, []);

  const setNotifications = useCallback(async (on: boolean) => {
    if (on && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const answer = await Notification.requestPermission();
      if (answer !== "granted") { setNotificationsState(false); return; }
    }
    setNotificationsState(on);
    try { localStorage.setItem(NOTIFY_KEY, on ? "on" : "off"); } catch { /* lasts until the page closes */ }
  }, []);
  const notificationsBlocked = typeof Notification === "undefined" || Notification.permission === "denied";

  const resizeTo = useCallback((width: number, save: boolean) => {
    const next = Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(width)));
    setSideWidth(next);
    if (save) try { localStorage.setItem(SIDE_KEY, String(next)); } catch { /* not remembered */ }
  }, []);
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const move = (e: PointerEvent) => resizeTo(e.clientX, false);
    const up = (e: PointerEvent) => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); resizeTo(e.clientX, true); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const openText = useCallback(async (conversationId: string, message: ServerMessage): Promise<{ text: string; sealed: boolean; raw?: string }> => {
    if (!message.ciphertext) return { text: "Message", sealed: false };
    try {
      const plain = await messaging.open(message.ciphertext, { conversationId, senderUserId: message.senderUserId, messageId: message.id });
      return { text: describeBody(plain).text, sealed: false, raw: plain };
    } catch (cause) {
      // A message sent before this computer was linked was never sealed for it. If the phone has since sent it over, it is there.
      const saved = (await store.messages(conversationId)).find((m) => m.id === message.id);
      if (saved) return { text: describeBody(saved.text).text, sealed: false, raw: saved.text };
      if (!(cause instanceof SecureChatError)) console.warn("A message could not be opened", cause);
      return { text: "", sealed: true };
    }
  }, [messaging, store]);

  const rememberPeers = useCallback((list: InboxChat[]) => {
    for (const c of list) {
      if (c.isGroup && c.memberUserIds) peers.current.set(c.conversationId, c.memberUserIds.filter((id) => id !== userId));
      else if (c.peerUserId) peers.current.set(c.conversationId, [c.peerUserId]);
    }
  }, [peers, userId]);

  const loadLists = useCallback(async () => { try { setLists(await api.chatLists()); } catch { /* the next refresh tries again */ } }, [api]);

  const loadInbox = useCallback(async () => {
    try {
      const { chats: list, counts: nextCounts } = await api.inboxWithCounts();
      rememberPeers(list);
      setChats(list);
      setCounts(nextCounts);
      setConnected(true);
      setLastSync(new Date());
      // Lists change rarely: refresh them on the first poll and then every few polls (the server limits how often one computer may ask).
      if (polls.current++ % 6 === 0) void loadLists();
      // Tell the person about new unread messages when this tab is in the background (never what they say).
      const unreadNow = list.reduce((n, c) => n + c.unreadCount, 0);
      if (notifications && unreadSeen.current !== null && unreadNow > unreadSeen.current && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
        const fresh = list.find((c) => c.unreadCount > 0 && !c.muted);
        if (!fresh) { unreadSeen.current = unreadNow; return; }
        try { new Notification("Linqa", { body: fresh ? `New message from ${fresh.title}` : "New message", tag: "linqa-new-message" }); } catch { /* the browser refused; nothing else to do */ }
      }
      unreadSeen.current = unreadNow;
      // The server keeps no preview, so the newest readable message of each chat is opened here.
      for (const c of list.filter((x) => x.updatedAt).slice(0, PREVIEW_LIMIT)) {
        const key = `${c.conversationId}:${c.updatedAt}`;
        if (previewCache.current.has(key)) continue;
        previewCache.current.set(key, "");
        try {
          const recent = await api.history(c.conversationId, PREVIEW_SCAN);
          let label = "";
          for (const message of recent) {
            const opened = await openText(c.conversationId, message);
            if (!opened.sealed) {
              // A vote is not a message; a poll reads as "Poll: question".
              if (parseBody(opened.raw)?.type === "vote") continue;
              label = (message.senderUserId === userId ? "You: " : "") + opened.text; break;
            }
          }
          if (!label) label = UNAVAILABLE_PREVIEW;
          previewCache.current.set(key, label);
          setPreviews((p) => ({ ...p, [c.conversationId]: label }));
        } catch { previewCache.current.delete(key); }
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message === "SESSION_EXPIRED") { await signOut(); return; }
      setConnected(false);
    }
  }, [api, loadLists, notifications, openText, rememberPeers, signOut, userId]);

  useEffect(() => {
    void loadInbox();
    const id = setInterval(() => void loadInbox(), INBOX_POLL_MS);
    const onFocus = () => void loadInbox();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [loadInbox, historyVersion]);

  // The archive is loaded when it is opened, and refreshed with the main list.
  useEffect(() => {
    if (view.kind !== "archived") return;
    void api.archivedChats().then((list) => { rememberPeers(list); setArchivedChats(list); }).catch(() => undefined);
  }, [api, view, counts.archived, rememberPeers]);

  useEffect(() => { void api.myName().then(setMyName).catch(() => undefined); }, [api]);
  useEffect(() => {
    const check = () => void api.devices().then((list) => setPhoneLinked(list.some((d) => d.platform === "ANDROID" || d.platform === "IOS"))).catch(() => undefined);
    check();
    const id = setInterval(check, DEVICES_POLL_MS);
    return () => clearInterval(id);
  }, [api]);

  // Close the + menu with Escape or a click elsewhere.
  useEffect(() => {
    if (!plusMenu) return;
    const close = () => setPlusMenu(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", close);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("click", close); };
  }, [plusMenu]);

  const pool = view.kind === "archived" ? archivedChats : chats;
  const shown = useMemo(() => {
    switch (view.kind) {
      case "unread": return pool.filter((c) => c.unreadCount > 0);
      case "favorites": return pool.filter((c) => c.pinned);
      case "groups": return pool.filter((c) => c.isGroup);
      case "list": return pool.filter((c) => c.listIds?.includes(view.listId));
      default: return pool;
    }
  }, [pool, view]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? shown.filter((c) => c.title.toLowerCase().includes(q) || (previews[c.conversationId] ?? "").toLowerCase().includes(q)) : shown;
  }, [shown, previews, query]);

  // Open the first chat on arrival, so the screen is never an empty pane when there is something to read.
  useEffect(() => { if (!autoOpened.current && !activeId && chats.length > 0) { autoOpened.current = true; setActiveId(chats[0]!.conversationId); } }, [activeId, chats]);

  // How many people are waiting to message this person (shown in the Linqa Menu).
  const loadRequests = useCallback(async () => { try { setRequestCount((await api.messageRequests()).length); } catch { /* shown as none */ } }, [api]);
  useEffect(() => {
    void loadRequests();
    const id = setInterval(() => void loadRequests(), 60_000);
    return () => clearInterval(id);
  }, [loadRequests]);

  const active = useMemo(() => [...chats, ...archivedChats].find((c) => c.conversationId === activeId) ?? null, [chats, archivedChats, activeId]);
  const contacts: Contact[] = useMemo(() => chats.filter((c) => !c.isGroup && c.peerUserId).map((c) => ({ userId: c.peerUserId!, name: c.title })), [chats]);
  const listById = (id: string) => lists.find((l) => l.id === id);
  const viewTitle = view.kind === "list" ? listById(view.listId)?.name ?? "List" : view.kind === "archived" ? "Archived" : null;

  const refreshAll = () => { void loadInbox(); void loadLists(); if (view.kind === "archived") void api.archivedChats().then(setArchivedChats).catch(() => undefined); };
  const organize = async (work: () => Promise<unknown>, failure: string) => {
    try { await work(); setOrganizeNote(null); refreshAll(); } catch { setOrganizeNote(failure); }
  };
  const toggleFavorite = (c: InboxChat) => organize(() => api.setFavorite(c.conversationId, !c.pinned), "Could not change favorites. Try again.");
  const toggleArchive = (c: InboxChat) => organize(() => api.setArchived(c.conversationId, !c.archived), "Could not change the archive. Try again.");
  const toggleInList = (c: InboxChat, listId: string) => organize(() => api.setInList(listId, c.conversationId, !c.listIds?.includes(listId)), "Could not change the list. Try again.");

  const openControl = async (kind: ControlKind) => {
    if (!active) return;
    try { setCtl({ kind, info: await api.controls(active.conversationId) }); } catch { setOrganizeNote("Could not load this chat's details. Try again."); }
  };
  /** Sends a message's text to other chats, sealed for the people in each one. */
  const forwardTo = async (conversationIds: string[]) => {
    const text = forwardText;
    if (!text) return;
    forwardBatch.current??=new ForwardBatch(()=>crypto.randomUUID(),(target,id)=>messaging.seal(JSON.stringify({type:'text',text,lane:'General',forwarded:true}),{conversationId:target,senderUserId:userId,clientMessageId:id}),(target,id,sealed)=>api.send(target,id,sealed));
    const failed=await forwardBatch.current.send(conversationIds);
    void loadInbox();
    if(failed.length>0)throw new Error('FORWARD_FAILED');
  };
  const afterChange = () => { previewCache.current.clear(); setHistoryVersion((v) => v + 1); refreshAll(); };
  const toggleMute = (c: InboxChat) => organize(() => api.setMuted(c.conversationId, !c.muted), "Could not change notifications. Try again.");

  const startSync = () => { setDialog("history"); void sync.start(); };
  const syncing = ["requesting", "waiting", "transferring", "opening"].includes(sync.state.step);
  const chip = (kind: Exclude<View["kind"], "list">, label: string, count?: number, icon?: ReactNode) => (
    <button type="button" className="lc-chip" data-on={view.kind === kind} aria-pressed={view.kind === kind} onClick={() => setView({ kind })}>
      {icon}{t(label)}{count ? <span className="lc-chip-count">{count}</span> : null}
    </button>
  );

  return (
    <main className="lc-page">
      <div className="lc-shell" data-panel={panel ?? undefined} style={{ "--lc-side": `${sideWidth}px` } as React.CSSProperties}>
        <aside className="lc-side" aria-label={t("Chats")}>
          <header className="lc-brand">
            <LinqaMark size={36} /><h1>Linqa</h1>
            <button type="button" className="lc-me" aria-label={`Settings for ${myName || "your account"}`} title={t("Settings")} onClick={() => setPanel((v) => (v === "settings" ? null : "settings"))}>
              {initialsOf(myName || "?")}
            </button>
          </header>

          <button type="button" className="lc-new" onClick={() => setDialog("new")}><PlusIcon size={20} />{t("New chat")}</button>

          <label className="lc-search">
            <SearchIcon size={18} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search conversations")} aria-label={t("Search conversations")} />
          </label>

          <div className="lc-chips" role="group" aria-label="Filter chats">
            {chip("all", "All")}
            {chip("unread", "Unread", counts.unread)}
            {chip("favorites", "Favorites", undefined, <StarIcon size={15} />)}
          </div>
          <div className="lc-chips" role="group" aria-label="More filters">
            {chip("groups", "Groups", undefined, <UsersIcon size={15} />)}
            <button type="button" className="lc-chip" data-on={view.kind === "list"} aria-expanded={listsOpen} onClick={() => setListsOpen((v) => !v)}><ListIcon size={15} />{t("Lists")}<ChevronDownIcon size={14} /></button>
            <div className="lc-menu-wrap">
              <button type="button" className="lc-chip lc-chip-plus" aria-label="Create or manage" aria-haspopup="menu" aria-expanded={plusMenu} onClick={(e) => { e.stopPropagation(); setPlusMenu((v) => !v); }}><PlusIcon size={16} /></button>
              {plusMenu ? (
                <div className="lc-menu lc-menu-left" role="menu">
                  <button type="button" role="menuitem" onClick={() => setDialog("list")}><PlusIcon size={18} />{t("Create a list")}</button>
                  <button type="button" role="menuitem" onClick={() => setDialog("group")}><UsersIcon size={18} />{t("Create a group")}</button>
                  <button type="button" role="menuitem" disabled={!active?.isGroup} title={active?.isGroup ? undefined : "Open a group first"} onClick={() => setDialog("addPeople")}><UserPlusIcon size={18} />{t("Add people")}</button>
                  <button type="button" role="menuitem" onClick={() => setDialog("manageLists")}><ListIcon size={18} />{t("Manage lists")}</button>
                </div>
              ) : null}
            </div>
          </div>
          <button type="button" className="lc-archived-row" data-on={view.kind === "archived"} onClick={() => setView({ kind: view.kind === "archived" ? "all" : "archived" })}>
            <ArchiveIcon size={18} />{t("Archived")}<span>{counts.archived}</span>
          </button>

          {listsOpen && lists.length > 0 ? (
            <div className="lc-mylists">
              <p className="lc-section">{t("My lists")}</p>
              {lists.map((l) => (
                <button key={l.id} type="button" className="lc-listrow" data-color={l.color} data-on={view.kind === "list" && view.listId === l.id} onClick={() => setView({ kind: "list", listId: l.id })}>
                  <FolderIcon size={17} />{l.name}<span>{l.count}</span>
                </button>
              ))}
            </div>
          ) : null}

          <p className="lc-section">{viewTitle ? `${viewTitle}` : "Conversations"}</p>
          {organizeNote ? <p className="lc-dialog-note" role="alert" data-warn style={{ padding: "0 4px" }}>{organizeNote}</p> : null}
          <ul className="lc-list">
            {visible.map((c) => (
              <li key={c.conversationId}>
                <button type="button" className="lc-row" data-active={c.conversationId === activeId} onClick={() => setActiveId(c.conversationId)}>
                  <Avatar chat={c} />
                  <span className="lc-row-main">
                    <span className="lc-row-top"><strong>{c.title}{c.pinned ? <i className="lc-fav" aria-label="Favorite">★</i> : null}</strong><time>{timeLabel(c.updatedAt)}</time></span>
                    <span className="lc-row-sub" data-muted={previews[c.conversationId] === UNAVAILABLE_PREVIEW || undefined}>{previews[c.conversationId] || (c.updatedAt ? "…" : "No messages yet")}</span>
                  </span>
                  {c.unreadCount > 0 ? <span className="lc-badge" aria-label={`${c.unreadCount} unread`}>{c.unreadCount}</span> : null}
                </button>
              </li>
            ))}
            {visible.length === 0 ? <li className="lc-empty">{query ? "No conversations match." : view.kind === "all" ? "No chats yet. Choose New chat to start one." : "Nothing here yet."}</li> : null}
          </ul>

          <nav className="lc-bottom" aria-label={t("Account")}>
            <button type="button" onClick={() => setPanel((v) => (v === "linqa" ? null : "linqa"))}><GridIcon size={20} />Linqa Menu{requestCount > 0 ? <span className="lc-badge">{requestCount}</span> : null}</button>
            <button type="button" onClick={() => setDialog("devices")}><LaptopIcon size={20} />{t("Linked devices")}</button>
            <button type="button" onClick={() => setPanel((v) => (v === "settings" ? null : "settings"))}><GearIcon size={20} />{t("Settings")}</button>
            <button type="button" onClick={confirmSignOut}><SignOutIcon size={20} />{t("Sign out")}</button>
          </nav>

          <div
            className="lc-resize" role="separator" aria-orientation="vertical" aria-label="Resize chat list" tabIndex={0}
            aria-valuemin={SIDE_MIN} aria-valuemax={SIDE_MAX} aria-valuenow={sideWidth}
            onPointerDown={startResize}
            onDoubleClick={() => resizeTo(SIDE_DEFAULT, true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") { e.preventDefault(); resizeTo(sideWidth - 16, true); }
              if (e.key === "ArrowRight") { e.preventDefault(); resizeTo(sideWidth + 16, true); }
            }}
          />
        </aside>

        <section className="lc-thread" aria-label="Conversation">
          {active ? (
            <Thread
              key={active.conversationId}
              chat={active}
              runtime={runtime}
              store={store}
              storeVersion={historyVersion}
              openText={openText}
              onSent={() => void loadInbox()}
              connected={connected}
              lastSync={lastSync}
              computerName={computerName}
              phoneLinked={phoneLinked}
              enterToSend={enterToSend}
              synced={synced}
              syncState={sync.state}
              syncing={syncing}
              lists={lists}
              handle={threadHandle}
              onForward={beginForward}
              onControl={(kind) => void openControl(kind)}
              onCloseChat={() => setActiveId(null)}
              onToggleMute={() => void toggleMute(active)}
              onHistory={() => (sync.state.step === "idle" || sync.state.step === "failed") ? startSync() : setDialog("history")}
              onCancelSync={() => void sync.cancel()}
              onDevices={() => setDialog("devices")}
              onFavorite={() => void toggleFavorite(active)}
              onArchive={() => void toggleArchive(active)}
              onToggleList={(listId) => void toggleInList(active, listId)}
              onAddPeople={() => setDialog("addPeople")}
            />
          ) : <div className="lc-center"><p>Select a chat to start messaging.</p></div>}
        </section>

        {panel === "linqa" ? (
          <LinqaMenuPanel
            activeTitle={active?.title ?? null} requestCount={requestCount}
            onFeature={mode=>{if(mode==='vault')setVaultOpen(true);else threadHandle.current?.openFeature(mode);}}
            canPoll={Boolean(active && (active.isGroup ? (active.memberUserIds?.length ?? 0) > 1 : active.peerUserId))}
            onPoll={() => setDialog("poll")} onRequests={() => setDialog("requests")} onBlocked={() => setDialog("blocked")} onClose={() => setPanel(null)}
          />
        ) : null}
        {panel === "settings" ? (
          <SettingsPanel
            defaultName={defaultName} enterToSend={enterToSend} onEnterToSend={setEnterToSend} onSaved={setComputerNameState}
            notifications={notifications} notificationsBlocked={notificationsBlocked} onNotifications={(on) => void setNotifications(on)}
            favorites={counts.favorites} archived={counts.archived} lists={lists.length}
            onManageLists={() => setDialog("manageLists")} onFavorites={() => setView({ kind: "favorites" })} onArchived={() => setView({ kind: "archived" })}
            onSignOut={() => { setPanel(null); confirmSignOut(); }} onClose={() => setPanel(null)}
          />
        ) : null}
      </div>

      {vaultOpen?<DesktopVaultDialog runtime={runtime} onClose={()=>setVaultOpen(false)}/>:null}
      {dialog === "new" ? <NewChatDialog api={api} onClose={() => setDialog(null)} onOpened={(id) => { setActiveId(id); void loadInbox(); }} /> : null}
      {dialog === "devices" ? <LinkedDevicesDialog api={api} onClose={() => setDialog(null)} /> : null}
      {dialog === "history" ? <HistoryDialog state={sync.state} onStart={() => void sync.start()} onCancel={() => void sync.cancel()} onClose={() => { setDialog(null); if (sync.state.step === "complete") sync.reset(); }} /> : null}
      {dialog === "list" ? <ListDialog api={api} onClose={() => setDialog(null)} onDone={() => { void loadLists(); setListsOpen(true); }} /> : null}
      {dialog === "manageLists" ? <ManageListsDialog api={api} lists={lists} onClose={() => setDialog(null)} onChanged={() => { void loadLists(); refreshAll(); }} /> : null}
      {dialog === "group" ? <GroupDialog api={api} contacts={contacts} onClose={() => setDialog(null)} onCreated={(id) => { setView({ kind: "all" }); setActiveId(id); void loadInbox(); }} /> : null}
      {forwardText !== null ? <ForwardDialog chats={[...chats].filter((c) => (c.isGroup ? (c.memberUserIds?.length ?? 0) > 1 : Boolean(c.peerUserId)))} preview={forwardText} onClose={() => setForwardText(null)} onForward={forwardTo} /> : null}
      {dialog === "poll" && active ? <PollDialog chatTitle={active.title} onClose={() => setDialog(null)} onSend={(title, options) => threadHandle.current?.sendPoll(title, options) ?? Promise.reject(new Error("no chat"))} /> : null}
      {dialog === "requests" ? <MessageRequestsDialog api={api} onClose={() => setDialog(null)} onChanged={() => { void loadRequests(); refreshAll(); }} /> : null}
      {dialog === "blocked" ? <BlockedDialog api={api} onClose={() => setDialog(null)} onChanged={() => refreshAll()} /> : null}
      {ctl?.kind === "contact" ? <ContactInfoDialog info={ctl.info} onClose={() => setCtl(null)} /> : null}
      {ctl?.kind === "disappearing" ? <DisappearingDialog api={api} info={ctl.info} onClose={() => setCtl(null)} onChanged={() => refreshAll()} /> : null}
      {ctl?.kind === "report" ? <ReportDialog api={api} info={ctl.info} onClose={() => setCtl(null)} onDone={() => undefined} /> : null}
      {ctl?.kind === "block" && ctl.info.peer ? (
        <ConfirmDialog
          title={`Block ${ctl.info.peer.displayName}?`} danger confirm="Block"
          body="They will not be able to message or call you, and this chat will leave your list. They are not told. You can unblock them in the Linqa Menu."
          onConfirm={async () => { await api.blockUser(ctl.info.peer!.userId); setActiveId(null); afterChange(); }} onClose={() => setCtl(null)}
        />
      ) : null}
      {ctl?.kind === "clear" ? (
        <ConfirmDialog
          title="Clear this chat?" confirm="Clear chat" danger
          body="Messages in this chat will be removed from your devices. The other people keep their copy, and new messages will still arrive."
          onConfirm={async () => { await api.clearChat(ctl.info.conversationId); await store.forget(ctl.info.conversationId); afterChange(); }} onClose={() => setCtl(null)}
        />
      ) : null}
      {ctl?.kind === "delete" ? (
        <ConfirmDialog
          title="Delete this chat?" confirm="Delete chat" danger
          body="The chat and its messages are removed from your devices and your lists. The other people keep their copy. A new message from them will bring the chat back."
          onConfirm={async () => { await api.deleteChat(ctl.info.conversationId); await store.forget(ctl.info.conversationId); setActiveId(null); afterChange(); }} onClose={() => setCtl(null)}
        />
      ) : null}
      {dialog === "addPeople" && active?.isGroup ? (
        <AddPeopleDialog api={api} groupId={active.conversationId} groupName={active.title} existing={active.memberUserIds ?? []} contacts={contacts} onClose={() => setDialog(null)} onDone={() => void loadInbox()} />
      ) : null}
    </main>
  );
}

function Thread({ chat, runtime, store, storeVersion, openText, onSent, connected, lastSync, computerName, phoneLinked, enterToSend, synced, syncState, syncing, lists, handle, onForward, onControl, onCloseChat, onToggleMute, onHistory, onCancelSync, onDevices, onFavorite, onArchive, onToggleList, onAddPeople }: {
  chat: InboxChat;
  runtime: Ready;
  store: HistoryStore;
  storeVersion: number;
  openText: (conversationId: string, message: ServerMessage) => Promise<{ text: string; sealed: boolean; raw?: string }>;
  onSent: () => void;
  handle: { current: ThreadHandle | null };
  onForward: (text: string) => void;
  onControl: (kind: ControlKind) => void;
  onCloseChat: () => void;
  onToggleMute: () => void;
  connected: boolean;
  lastSync: Date | null;
  computerName: string;
  phoneLinked: boolean | null;
  enterToSend: boolean;
  synced: boolean;
  syncState: ReturnType<typeof useHistorySync>["state"];
  syncing: boolean;
  lists: ChatListInfo[];
  onFavorite: () => void;
  onArchive: () => void;
  onToggleList: (listId: string) => void;
  onAddPeople: () => void;
  onHistory: () => void;
  onCancelSync: () => void;
  onDevices: () => void;
}) {
  useTranslation();
  const { api, messaging, userId } = runtime;
  const calls=useDesktopCalls();
  const [feature,setFeature]=useState<DesktopFeature|null>(null);
  const deletedLocally=useRef(new Map<string,Set<string>>());
  const [rows, setRows] = useState<Shown[]>([]);
  const [pending, setPending] = useState<Shown[]>([]);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [about, setAbout] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [find, setFind] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const payloads = useRef(new Map<string, object>());
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unreadRef = useRef(chat.unreadCount);
  unreadRef.current = chat.unreadCount;
  const sendable = chat.isGroup ? (chat.memberUserIds?.length ?? 0) > 1 : !!chat.peerUserId;

  const say = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Escape closes whatever is open on top, one layer at a time.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) setMenu(false);
      else if (emoji) setEmoji(false);
      else if (toast) setToast(null);
      else if (about) setAbout(false);
      else if (selecting) { setSelecting(false); setPicked(new Set()); }
      else if (replyTo) setReplyTo(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, emoji, toast, about, selecting, replyTo]);

  const load = useCallback(async () => {
    try {
      const messages = await api.history(chat.conversationId, 60);
      const saved=await store.messages(chat.conversationId);
      const visible=await api.visibleMessages(chat.conversationId,[...new Set([...messages.map(m=>m.id),...saved.map(m=>m.id)])]);
      const opened: Shown[] = [];
      for (const m of [...messages].reverse()) {
        if(!visible.has(m.id))continue;
        const shown = await openText(chat.conversationId, m);
        opened.push({ id: m.id, mine: m.senderUserId === userId, text: shown.text, at: m.createdAt, sealed: shown.sealed, raw: shown.raw, sender: m.senderUserId });
      }
      // Older messages the phone sent over, from before the ones the server returned above.
      const have = new Set(opened.map((o) => o.id));
      const firstAt = opened[0]?.at ?? "9999";
      const older: Shown[] = saved
        .filter((m) => visible.has(m.id) && !have.has(m.id) && m.at < firstAt)
        .map((m) => ({ id: m.id, mine: m.senderUserId === userId, text: describeBody(m.text).text, at: m.at, raw: m.text, sender: m.senderUserId }));
      setRows(foldPolls([...older, ...opened].filter(m=>!deletedLocally.current.get(chat.conversationId)?.has(m.id))));
      setPending((p) => p.filter((x) => x.state === "failed" || !opened.some((o) => o.id === x.id)));
      if (unreadRef.current > 0) void api.markRead(chat.conversationId).catch(() => undefined);
    } catch { /* the next poll tries again */ }
  }, [api, chat.conversationId, openText, store, userId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), THREAD_POLL_MS);
    return () => clearInterval(id);
  }, [load, storeVersion]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [rows.length, pending.length]);

  // The box grows with what is typed, up to a few lines.
  useLayoutEffect(() => {
    const box = input.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 140)}px`;
  }, [draft]);

  const deliver = async (id: string, text: string) => {
    setPending((p) => p.map((x) => (x.id === id ? { ...x, state: "sending" } : x)));
    try {
      // The same body the phone sends for a text message, so it shows up there as a normal message.
      const sealed = await messaging.seal(JSON.stringify(payloads.current.get(id) ?? { type: "text", text, lane: "General" }), { conversationId: chat.conversationId, senderUserId: userId, clientMessageId: id });
      await api.send(chat.conversationId, id, sealed);
      // The server has it now: the real row replaces the placeholder on the next load.
      setPending((p) => p.filter((x) => x.id !== id));
      setSendError(null);
      onSent();
      void load();
      return true;
    } catch (cause) {
      setPending((p) => p.map((x) => (x.id === id ? { ...x, state: "failed" } : x)));
      const code = cause instanceof SecureChatError ? cause.code : cause instanceof Error ? cause.message : "";
      setSendError(code === "RECIPIENT_NOT_READY" ? `${chat.title} has not opened Linqa on a device that can receive this yet.` : code === "NETWORK" ? "No connection. Your message was not sent." : "The message could not be sent.");
      return false;
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text || !sendable) return;
    setDraft(""); setEmoji(false); setSendError(null);
    const id = crypto.randomUUID();
    payloads.current.set(id, { type: "text", text, lane: "General", ...(replyTo ? { reply: replyTo } : {}) });
    const quoted = replyTo;
    setReplyTo(null);
    setPending((p) => [...p, { id, mine: true, text, at: new Date().toISOString(), state: "sending", ...(quoted ? { reply: quoted } : {}) }]);
    void deliver(id, text);
  };

  const startReply = (m: Shown) => {
    if (!sendable || m.state || m.sealed) return;
    setReplyTo({ id: m.id, senderId: m.sender ?? (m.mine ? userId : ""), text: (m.poll ? `Poll: ${m.poll.title}` : m.text).slice(0, 160) });
    input.current?.focus();
  };
  const who = (senderId: string) => (senderId === userId ? "You" : chat.title);
  const jumpTo = (id: string) => {
    const el = document.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id)}"]`);
    if (!el) { say("That message is not on screen. Scroll up to find it."); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.dataset.flash = "true";
    setTimeout(() => { delete el.dataset.flash; }, 1400);
  };
  const copyText = async (m: Shown) => { try { await navigator.clipboard.writeText(m.text); say("Copied."); } catch { say("Could not copy. Your browser blocked it."); } };

  const sendPoll = async (title: string, options: string[]) => {
    const id = crypto.randomUUID();
    payloads.current.set(id, { type: "decision", title, options });
    setPending((p) => [...p, { id, mine: true, text: `Poll: ${title}`, at: new Date().toISOString(), state: "sending" }]);
    await deliver(id, `Poll: ${title}`);
  };
  const sendFeature=async(payload:object,label:string)=>{
    const id=crypto.randomUUID();payloads.current.set(id,payload);
    setPending(p=>[...p,{id,mine:true,text:label,raw:JSON.stringify(payload),sender:userId,at:new Date().toISOString(),state:'sending'}]);
    if(!await deliver(id,label))throw new Error('Message not sent. Use Retry in the conversation.');
  };
  const openFeature=(mode:DesktopFeature)=>{
    if(['voice-call','video-call','whiteboard','recording'].includes(mode)){
      const users=runtime.peers.current.get(chat.conversationId)??[];
      void calls.start(chat.conversationId,mode==='video-call'?'video':'voice',users).then(()=>{if(mode==='whiteboard')calls.manager?.state.engine?.openBoard();}).catch(e=>say(e instanceof Error?e.message:'Could not start call.'));
    }else setFeature(mode);
  };
  handle.current = { sendPoll,openFeature };
  useEffect(() => () => { handle.current = null; }, [handle]);

  const vote = async (boardId: string, choice: number) => {
    try {
      const id = crypto.randomUUID();
      const sealed = await messaging.seal(JSON.stringify({ type: "vote", boardId, choice }), { conversationId: chat.conversationId, senderUserId: userId, clientMessageId: id });
      await api.send(chat.conversationId, id, sealed);
      void load();
    } catch { say("Your vote could not be sent. Try again."); }
  };

  const togglePick = (id: string) => setPicked((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const stopSelecting = () => { setSelecting(false); setPicked(new Set()); };
  const copyPicked = async () => {
    const text = rows.filter((r) => picked.has(r.id) && !r.sealed).map((r) => `[${new Date(r.at).toLocaleString()}] ${r.mine ? "You" : chat.title}: ${r.text}`).join("\n");
    try { await navigator.clipboard.writeText(text); say(`Copied ${picked.size} message${picked.size === 1 ? "" : "s"}.`); stopSelecting(); } catch { say("Could not copy. Your browser blocked it."); }
  };

  const retry = (m: Shown) => { setSendError(null); void deliver(m.id, m.text); };
  const discard = (m: Shown) => { setPending((p) => p.filter((x) => x.id !== m.id)); setSendError(null); };

  const needle = find?.trim().toLowerCase() ?? "";
  const items = useMemo(() => toItems(needle ? rows.filter((r) => !r.sealed && r.text.toLowerCase().includes(needle)) : rows), [rows, needle]);
  const anySealed = rows.some((r) => r.sealed);
  const canSend = draft.trim().length > 0;

  const syncLine =
    syncState.step === "requesting" || (syncState.step === "waiting" && syncState.phoneOnline) ? "Waiting for phone approval…"
    : syncState.step === "waiting" ? "Your phone appears to be offline."
    : syncState.step === "transferring" ? "Transferring…"
    : syncState.step === "opening" ? "Opening messages…"
    : syncState.step === "failed" ? "Sync stopped." : "";

  return (
    <FeatureThreadContext.Provider value={{runtime,conversationId:chat.conversationId,send:sendFeature}}>
    <>
      <header className="lc-thread-head">
        <Avatar chat={chat} size="lg" />
        <div className="lc-thread-title">
          <strong>{chat.title}</strong>
          <span className="lc-lock" title="Messages are end-to-end encrypted. Only the people in this chat and your linked devices can read them.">
            <LockSolidIcon size={14} />End-to-end encrypted
            {chat.online ? <><b>•</b><span className="lc-presence"><i />Online</span></> : null}
          </span>
        </div>
        <div className="lc-actions">
          <button type="button" className="lc-icon" aria-label={t("Search in this chat")} aria-pressed={find !== null} title={t("Search in this chat")} onClick={() => setFind((v) => (v === null ? "" : null))}><SearchIcon size={22} /></button>
          <button type="button" className="lc-icon" aria-label="Voice call" title="Voice call" onClick={() => openFeature("voice-call")}><PhoneIcon size={22} /></button>
          <button type="button" className="lc-icon" aria-label="Video call" title="Video call" onClick={() => openFeature("video-call")}><VideoIcon size={22} /></button>
          <div className="lc-menu-wrap">
            <button type="button" className="lc-icon" aria-label="More" aria-haspopup="menu" aria-expanded={menu} title="More" onClick={() => setMenu((v) => !v)}><DotsIcon size={22} /></button>
            {menu ? (
              <div className="lc-menu" role="menu" onMouseLeave={() => setMenu(false)}>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); onControl("contact"); }}><InfoIcon size={18} />{chat.isGroup ? "Group info" : "Contact info"}</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); setFind(""); }}><SearchIcon size={18} />{t("Search")}</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); setSelecting(true); }}><CheckSquareIcon size={18} />Select messages</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); onToggleMute(); }}><BellOffIcon size={18} />{chat.muted ? "Unmute notifications" : "Mute notifications"}</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); onControl("disappearing"); }}><TimerIcon size={18} />Disappearing messages</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); onFavorite(); }}><StarIcon size={18} />{chat.pinned ? "Remove from favorites" : "Add to favorites"}</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); onArchive(); }}><ArchiveIcon size={18} />{chat.archived ? "Unarchive" : "Archive"}</button>
                {chat.isGroup ? <button type="button" role="menuitem" onClick={() => { setMenu(false); onAddPeople(); }}><UserPlusIcon size={18} />{t("Add people")}</button> : null}
                {lists.length > 0 ? <p className="lc-menu-label">Add to list</p> : null}
                {lists.map((l) => (
                  <button key={l.id} type="button" role="menuitemcheckbox" aria-checked={chat.listIds?.includes(l.id) ?? false} onClick={() => onToggleList(l.id)}>
                    <span className="lc-dot" data-color={l.color} aria-hidden />{l.name}{chat.listIds?.includes(l.id) ? <CheckIcon size={16} className="lc-menu-check" /> : null}
                  </button>
                ))}
                <hr className="lc-rule" />
                <button type="button" role="menuitem" onClick={() => { setMenu(false); onCloseChat(); }}><CloseIcon size={18} />Close chat</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); onControl("report"); }}><FlagIcon size={18} />Report</button>
                {!chat.isGroup ? <button type="button" role="menuitem" className="lc-danger" onClick={() => { setMenu(false); onControl("block"); }}><BanIcon size={18} />Block</button> : null}
                <button type="button" role="menuitem" className="lc-danger" onClick={() => { setMenu(false); onControl("clear"); }}><TrashIcon size={18} />Clear chat</button>
                <button type="button" role="menuitem" className="lc-danger" onClick={() => { setMenu(false); onControl("delete"); }}><TrashIcon size={18} />Delete chat</button>
                <hr className="lc-rule" />
                <button type="button" role="menuitem" onClick={() => { setMenu(false); setAbout((v) => !v); }}><ShieldIcon size={18} />Security details</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); onDevices(); }}><LaptopIcon size={18} />{t("Linked devices")}</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); void load(); }}>Refresh</button>
              </div>
            ) : null}
          </div>
        </div>
        {toast ? <p className="lc-toast" role="status">{toast}<button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>×</button></p> : null}
      </header>

      <div className="lc-subbar">
        <span className="lc-conn" data-ok={connected}><i />{connected ? "Desktop connected" : "Reconnecting…"}</span>
        <b>•</b>
        <LaptopIcon size={16} /><span>This computer: <strong>{computerName}</strong></span>
        <b>•</b>
        <span className="lc-subbar-sync">Last sync {lastSync ? clock(lastSync) : "—"}</span>
      </div>

      {find !== null ? (
        <div className="lc-find">
          <SearchIcon size={16} />
          <input autoFocus value={find} onChange={(e) => setFind(e.target.value)} placeholder={t("Search in this chat")} aria-label={t("Search in this chat")} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setFind(null); } }} />
          <button type="button" className="lc-icon" aria-label="Close search" onClick={() => setFind(null)}><CloseIcon size={16} /></button>
        </div>
      ) : null}

      {about ? (
        <div className="lc-about" role="note">
          <ShieldIcon size={20} />
          <p>This computer is linked to your account and holds its own encryption keys. Only the people in this chat and your linked devices can read these messages. To remove this computer, open <strong>Settings &gt; Linked devices</strong> on your phone and choose <strong>Unlink</strong>.</p>
        </div>
      ) : null}

      {anySealed || syncing ? (
        <div className="lc-banner" role="note" data-open={bannerOpen}>
          <div className="lc-banner-row">
            <LockSolidIcon size={18} />
            <strong>{synced && !syncing ? "Some older messages are unavailable" : "Older history unavailable"}</strong>
            {syncing ? <span className="lc-banner-state" role="status">{syncLine}</span> : null}
            <span className="lc-banner-spacer" />
            {syncing ? (
              <>
                <button type="button" className="lc-banner-link" onClick={onHistory}>Details</button>
                <button type="button" className="lc-banner-btn" onClick={onCancelSync}>{t("Cancel")}</button>
              </>
            ) : (
              <>
                <button type="button" className="lc-banner-link" aria-expanded={bannerOpen} onClick={() => setBannerOpen((v) => !v)}>{bannerOpen ? "Hide" : "Why?"}</button>
                <button type="button" className="lc-banner-btn" onClick={onHistory}>{syncState.step === "failed" ? "Retry sync" : synced ? "Sync again" : "Sync from phone"}</button>
              </>
            )}
          </div>
          {bannerOpen ? <p className="lc-banner-more">{synced ? "Your phone sent everything it could open. Messages it could not open itself (for example, from before it was set up) cannot be recovered. " : ""}This computer was linked after these messages were sent, so it was never given the keys to read them. Your phone can send them over, sealed for this computer only, after you approve it on the phone.</p> : null}
          {syncState.step === "failed" && !syncing ? <p className="lc-banner-more" role="alert">{syncLine} Try again when your phone is ready.</p> : null}
        </div>
      ) : null}

      <div className="lc-messages" role="log" aria-live="polite">
        {items.map((item) => item.kind === "sealed-run" ? (
          <div key={`sealed-${item.key}`} className="lc-sealed"><LockSolidIcon size={14} /><span>{item.label}</span><b>•</b><span>Older history unavailable</span></div>
        ) : <MessageBubble key={item.message.id} m={item.message} userId={userId} onVote={vote} chatTitle={chat.title} onReply={sendable ? () => startReply(item.message) : undefined} onForward={onForward} onCopy={() => void copyText(item.message)} onJump={jumpTo} onDelete={async scope=>{await api.deleteMessage(chat.conversationId,item.message.id,scope);const hidden=deletedLocally.current.get(chat.conversationId)??new Set<string>();hidden.add(item.message.id);deletedLocally.current.set(chat.conversationId,hidden);setRows(prev=>prev.filter(r=>r.id!==item.message.id));await load();}} select={selecting ? { picked: picked.has(item.message.id), toggle: () => togglePick(item.message.id) } : undefined} />)}
        {pending.map((m) => <MessageBubble key={m.id} m={m} userId={userId} onRetry={() => retry(m)} onDiscard={() => discard(m)} />)}
        {items.length === 0 && pending.length === 0 ? <p className="lc-empty">New messages will appear here. You can start chatting now.</p> : null}
        <div ref={bottom} />
      </div>

      {sendError ? <p className="lc-note-bar" role="alert" data-tone="error">{sendError}<button type="button" onClick={() => setSendError(null)}>Dismiss</button></p> : null}
      {selecting ? (
        <div className="lc-selectbar">
          <span>{picked.size} selected</span>
          <button type="button" className="lc-btn lc-btn-primary" disabled={picked.size === 0} onClick={() => void copyPicked()}>{t("Copy")}</button>
          <button type="button" className="lc-btn" onClick={stopSelecting}>{t("Cancel")}</button>
        </div>
      ) : sendable ? (
        <>
        {replyTo ? (
          <div className="lc-replybar">
            <div><strong>Replying to {who(replyTo.senderId)}</strong><span>{replyTo.text}</span></div>
            <button type="button" className="lc-icon" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><CloseIcon size={18} /></button>
          </div>
        ) : null}
        <form className="lc-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <div className="lc-emoji-wrap">
            <button type="button" className="lc-emoji-btn" aria-label="Emoji" aria-expanded={emoji} onClick={() => setEmoji((v) => !v)}><SmileIcon size={22} /></button>
            {emoji ? <EmojiPicker onClose={() => setEmoji(false)} onPick={(e) => { setDraft((d) => d + e); input.current?.focus(); }} /> : null}
          </div>
          <textarea
            ref={input} rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("Type a message")} aria-label={t("Message")} maxLength={4000}
            aria-keyshortcuts={enterToSend ? "Enter" : "Control+Enter"}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              if (enterToSend ? !e.shiftKey : (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
            }}
          />
          <div className="lc-tools">
            <button type="button" className="lc-tool" aria-label="Attach a file" title="Attach" onClick={() => openFeature("attachments")}><PaperclipIcon size={22} /></button>
            <button type="button" className="lc-tool lc-tool-camera" aria-label="Photo or video" title="Photo or video" onClick={() => openFeature("photos")}><CameraIcon size={22} /><ChevronDownIcon size={14} /></button>
            <button type="button" className="lc-tool" onClick={()=>openFeature("gif")}>GIF</button>
            <i className="lc-tools-rule" />
            <button type="button" className="lc-tool" aria-label="Voice message" title="Voice message" onClick={() => openFeature("voice")}><MicIcon size={22} /></button>
          </div>
          <button type="submit" className="lc-send" disabled={!canSend} title={canSend ? "Send" : "Type a message to send"}><SendPlaneIcon size={20} />{t("Send")}</button>
        </form>
        </>
      ) : <p className="lc-note-bar">This chat cannot be replied to from a computer yet. Use your phone.</p>}

      <footer className="lc-status">
        <i data-ok={phoneLinked !== false} />
        {phoneLinked === false ? "No phone linked" : "Phone linked"}
      </footer>
    {feature?<DesktopFeatureDialog mode={feature} runtime={runtime} conversationId={chat.conversationId} onSend={sendFeature} onClose={()=>setFeature(null)}/>:null}
    </>
    </FeatureThreadContext.Provider>
  );
}

function MessageBubble({ m, userId, chatTitle, onReply, onForward, onCopy, onJump, onRetry, onDiscard, onVote, onDelete, select }: { m: Shown; userId: string; chatTitle?: string; onReply?: () => void; onForward?: (text: string) => void; onCopy?: () => void; onJump?: (id: string) => void; onRetry?: () => void; onDiscard?: () => void; onVote?: (boardId: string, choice: number) => void; onDelete?:(scope:'me'|'everyone')=>Promise<void>; select?: { picked: boolean; toggle: () => void } }) {
  useTranslation();
  const [deleteOpen,setDeleteOpen]=useState(false);
  const [deleteBusy,setDeleteBusy]=useState(false);
  const [deleteError,setDeleteError]=useState(false);
  const deleting=useRef(false);
  const remove=async(scope:'me'|'everyone')=>{if(deleting.current||!onDelete)return;if(!window.confirm(scope==='me'?'Delete this message from your devices? Other people keep their copy.':'Delete this message for everyone? Copies saved elsewhere cannot be removed.'))return;deleting.current=true;setDeleteBusy(true);setDeleteError(false);try{await onDelete(scope);setDeleteOpen(false);}catch{setDeleteError(true);}finally{deleting.current=false;setDeleteBusy(false);}};
  const votes = m.poll ? Object.values(m.poll.votes) : [];
  const mine = m.poll ? m.poll.votes[userId] : undefined;
  // Drag a message to the right (or swipe right on a trackpad) and let go to reply to it.
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const wheel = useRef({ sum: 0, at: 0, timer: 0 as unknown as ReturnType<typeof setTimeout> });
  const canReply = Boolean(onReply) && !m.state && !m.sealed && !select;
  // Received messages sit on the left and are dragged right; messages you sent sit on the right and are dragged left.
  const dir = m.mine ? -1 : 1;
  const bodyType = parseBody(m.raw)?.type;
  const forwardable = Boolean(onForward) && !m.poll && !m.sealed && !m.state && (bodyType === undefined || bodyType === "text");
  const pointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canReply || e.button !== 0 || (e.target as HTMLElement).closest("button,a,input,textarea,video,audio,.lc-msg-actions")) return;
    drag.current = { x: e.clientX, y: e.clientY, active: false };
  };
  const pointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const mx = (e.clientX - d.x) * dir;
    const my = e.clientY - d.y;
    if (!d.active) {
      if (!(mx > 10 && mx > Math.abs(my) * 2)) return;
      d.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      window.getSelection()?.removeAllRanges();
    }
    setDx(Math.max(0, Math.min(mx, 90)));
  };
  const pointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d?.active && e.type === "pointerup" && dx >= 64) onReply?.();
    setDx(0);
  };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // A trackpad swipe toward the reply direction: right on a received message, left on one you sent.
    const toward = -e.deltaX * dir;
    if (!canReply || !(Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5 && toward > 0)) return;
    const now = Date.now();
    wheel.current.sum = now - wheel.current.at > 400 ? toward : wheel.current.sum + toward;
    wheel.current.at = now;
    setDx(Math.min(wheel.current.sum, 90));
    clearTimeout(wheel.current.timer);
    if (wheel.current.sum >= 80) { wheel.current.sum = 0; setDx(0); onReply?.(); }
    else wheel.current.timer = setTimeout(() => setDx(0), 300);
  };
  return (
    <div
      className="lc-msg" data-msg-id={m.id} data-mine={m.mine} data-state={m.state} data-select={select ? true : undefined} data-picked={select?.picked || undefined}
      data-dragging={dx > 0 || undefined} style={dx ? { transform: `translateX(${dx * dir}px)` } : undefined}
      onClick={select?.toggle} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onWheel={onWheel}
    >
      {canReply ? <span className="lc-swipe-hint" data-side={m.mine ? "right" : "left"} style={{ opacity: Math.min(dx / 64, 1) }} aria-hidden><ReplyIcon size={22} /></span> : null}
      {(canReply || forwardable) && !select ? (
        <div className="lc-msg-actions" role="toolbar" aria-label="Message actions">
          {canReply ? <button type="button" aria-label={t("Reply")} title={t("Reply")} onClick={onReply}><ReplyIcon size={17} /></button> : null}
          {forwardable ? <button type="button" aria-label={t("Forward")} title={t("Forward")} onClick={() => onForward?.(m.text)}><ForwardIcon size={17} /></button> : null}
          {!m.poll && !m.sealed && m.text ? <button type="button" aria-label="Copy text" title="Copy text" onClick={onCopy}><CopyIcon size={17} /></button> : null}
        </div>
      ) : null}
      {m.forwarded ? <span className="lc-fwd">Forwarded</span> : null}
      {m.reply ? (
        <button type="button" className="lc-quote" aria-label={`Replying to ${m.reply.senderId === userId ? "you" : chatTitle ?? "them"}: ${m.reply.text}. Go to that message`} onClick={() => onJump?.(m.reply!.id)}>
          <strong>{m.reply.senderId === userId ? "You" : chatTitle ?? "Them"}</strong><span>{m.reply.text}</span>
        </button>
      ) : null}
      {select ? <label className="lc-msg-pick"><input type="checkbox" checked={select.picked} onChange={select.toggle} aria-label="Select message" /></label> : null}
      {m.poll ? (
        <div className="lc-poll" role="group" aria-label={`Poll: ${m.poll.title}`}>
          <strong>{m.poll.title}</strong>
          {m.poll.options.map((option, i) => {
            const count = votes.filter((v) => v === i).length;
            return (
              <button key={i} type="button" data-mine={mine === i} disabled={!onVote || Boolean(select)} onClick={() => onVote?.(m.id, i)}>
                <i style={{ width: votes.length ? `${(count / votes.length) * 100}%` : 0 }} /><span>{option}</span><span>{count}</span>
              </button>
            );
          })}
          <small>{votes.length} {votes.length === 1 ? "vote" : "votes"}{mine === undefined ? " · tap an option to vote" : ""}</small>
        </div>
      ) : <DesktopMessage raw={m.raw} text={m.text} sender={m.sender}/> }
      {onDelete && !select ? <div className="lc-message-delete"><button type="button" disabled={deleteBusy} onClick={()=>setDeleteOpen(v=>!v)} aria-label="Delete message" aria-expanded={deleteOpen}>{t("Delete")}</button>{deleteOpen?<><button type="button" disabled={deleteBusy} onClick={()=>void remove('me')}>Delete for me</button>{m.mine?<button type="button" disabled={deleteBusy} onClick={()=>void remove('everyone')}>Delete for everyone</button>:null}<button type="button" disabled={deleteBusy} onClick={()=>setDeleteOpen(false)}>{t("Cancel")}</button></>:null}{deleteError?<span role="alert">Could not delete. Please try again.</span>:null}</div>:null}
      <time>
        {m.state === "failed" ? (
          <>
            <span className="lc-failed">Not sent</span>
            <button type="button" className="lc-retry" onClick={onRetry}>Retry</button>
            <button type="button" className="lc-retry" onClick={onDiscard}>{t("Delete")}</button>
          </>
        ) : (
          <>
            {clock(m.at)}
            {m.state === "sending" ? <span className="lc-sending"><i />Sending…</span> : m.mine ? <CheckIcon size={14} className="lc-tick" /> : null}
          </>
        )}
      </time>
    </div>
  );
}
