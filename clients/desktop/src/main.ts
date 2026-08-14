/**
 * Linqa Desktop — UI shell.
 *
 * Vanilla TS + DOM (no framework) rendering into the Tauri webview.
 * All data currently comes from CoreBridge, which is backed by in-memory
 * mock data until linqa-core is buildable and wired through src-tauri.
 */
import "./styles.css";
import type { Conversation, LinkedDevice, Message, Profile } from "./types";
import { CoreBridge } from "./services/CoreBridge";
import { contactFor, conversationSubtitle, lastMessageTime } from "./mock/data";
import { formatClock, formatRelative } from "./utils/format";
import { el, clear } from "./utils/dom";

const STATUS_GLYPH: Record<Message["status"], string> = {
  sending: "○",
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
};

const PLATFORM_ICON: Record<LinkedDevice["platform"], string> = {
  web: "🌐",
  desktop: "🖥",
  android: "📱",
  ios: "📱",
};

function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

function avatar(initials: string, hue: number, size = 40): HTMLElement {
  return el("div", {
    class: "avatar",
    text: initials,
    style: {
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${size * 0.38}px`,
      background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 45%))`,
    },
  });
}

interface AppState {
  conversations: Conversation[];
  activeId: string | null;
  messages: Message[];
  searchQuery: string;
}

const state: AppState = {
  conversations: [],
  activeId: null,
  messages: [],
  searchQuery: "",
};

const app = document.getElementById("app")!;

const titlebar = el("div", { class: "titlebar", text: "Linqa" });

const conversationListEl = el("div", { class: "conversation-list" });
const searchInput = el("input", { attrs: { placeholder: "Search conversations" } });
searchInput.addEventListener("input", () => {
  state.searchQuery = searchInput.value;
  renderConversationList();
});

const settingsBtn = el("button", {
  class: "icon-btn",
  text: "⚙",
  attrs: { title: "Settings", "aria-label": "Settings" },
  onClick: () => openSettings(),
});

const sidebar = el("div", { class: "sidebar" }, [
  el("div", { class: "sidebar-header" }, [
    avatar("YOU", 230, 34),
    el("div", { class: "brand", text: "Linqa" }),
    settingsBtn,
  ]),
  el("div", { class: "search-box" }, [searchInput]),
  conversationListEl,
]);

const chatHeaderEl = el("div", { class: "chat-header" });
const messageListEl = el("div", { class: "message-list" });
const chatEmptyEl = el("div", { class: "chat-empty", text: "Select a conversation" });

const composerInput = el("input", { attrs: { placeholder: "Message…" } });
const sendBtn = el("button", {
  class: "send-btn",
  text: "➤",
  attrs: { "aria-label": "Send" },
});
sendBtn.setAttribute("disabled", "true");

composerInput.addEventListener("input", () => {
  if (composerInput.value.trim()) sendBtn.removeAttribute("disabled");
  else sendBtn.setAttribute("disabled", "true");
});
composerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSend();
});
sendBtn.addEventListener("click", () => handleSend());

const composerEl = el("div", { class: "composer" }, [composerInput, sendBtn]);

const chatView = el("div", { class: "chat-view" }, [chatEmptyEl]);

const appShell = el("div", { class: "app-shell" }, [titlebar, sidebar, chatView]);
app.append(appShell);

function renderConversationList() {
  clear(conversationListEl);
  const query = state.searchQuery.toLowerCase();
  const filtered = state.conversations.filter((c) => c.title.toLowerCase().includes(query));
  const sorted = [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return lastMessageTime(b.id) - lastMessageTime(a.id);
  });

  if (sorted.length === 0) {
    conversationListEl.append(
      el("div", {
        text: `No conversations match "${state.searchQuery}"`,
        style: { padding: "16px", color: "var(--text-faint)", fontSize: "0.85rem" },
      })
    );
    return;
  }

  for (const c of sorted) {
    const single = !c.isGroup ? contactFor(c.participantIds[0]) : undefined;
    const hue = single?.colorHue ?? hueFromId(c.id);
    const initials = single?.initials ?? c.title.slice(0, 2).toUpperCase();

    const item = el(
      "button",
      {
        class: `conversation-item${c.id === state.activeId ? " active" : ""}`,
        onClick: () => selectConversation(c.id),
      },
      [
        avatar(initials, hue),
        el("div", { class: "conversation-meta" }, [
          el("div", { class: "conversation-title-row" }, [
            el("span", { class: "conversation-title", text: c.title }),
            el("span", { class: "conversation-time", text: formatRelative(lastMessageTime(c.id)) }),
          ]),
          el("div", { class: "conversation-subtitle-row" }, [
            el("span", { class: "conversation-subtitle", text: conversationSubtitle(c.id) }),
            c.unreadCount > 0
              ? el("span", { class: "unread-badge", text: String(c.unreadCount) })
              : null,
          ]),
        ]),
      ]
    );
    conversationListEl.append(item);
  }
}

async function selectConversation(id: string) {
  state.activeId = id;
  renderConversationList();
  await loadMessages(id);
}

async function loadMessages(id: string) {
  const conversation = state.conversations.find((c) => c.id === id);
  if (!conversation) return;

  clear(chatView);
  const single = !conversation.isGroup ? contactFor(conversation.participantIds[0]) : undefined;
  clear(chatHeaderEl);
  chatHeaderEl.append(
    avatar(
      single?.initials ?? conversation.title.slice(0, 2).toUpperCase(),
      single?.colorHue ?? hueFromId(conversation.id),
      34
    ),
    el("div", {}, [
      el("div", { class: "chat-header-title", text: conversation.title }),
      el("div", {
        class: "chat-header-sub",
        text:
          "🔒 End-to-end encrypted" +
          (single ? (single.online ? " · Online" : "") : ` · ${conversation.participantIds.length} members`),
      }),
    ])
  );

  chatView.append(chatHeaderEl, messageListEl, composerEl);

  state.messages = await CoreBridge.listMessages(id);
  renderMessages();
}

function renderMessages() {
  clear(messageListEl);
  for (const m of state.messages) {
    messageListEl.append(
      el("div", { class: `message-row ${m.isMine ? "mine" : "theirs"}` }, [
        el("div", { class: `bubble ${m.isMine ? "mine" : "theirs"}` }, [
          m.text,
          el("span", {
            class: "bubble-meta",
            text: formatClock(m.sentAt) + (m.isMine ? `  ${STATUS_GLYPH[m.status]}` : ""),
          }),
        ]),
      ])
    );
  }
  messageListEl.scrollTo({ top: messageListEl.scrollHeight });
}

async function handleSend() {
  const text = composerInput.value.trim();
  if (!text || !state.activeId) return;
  composerInput.value = "";
  sendBtn.setAttribute("disabled", "true");

  const optimistic: Message = {
    id: `pending-${Date.now()}`,
    conversationId: state.activeId,
    senderId: "me",
    text,
    sentAt: Date.now(),
    status: "sending",
    isMine: true,
  };
  state.messages.push(optimistic);
  renderMessages();

  const sent = await CoreBridge.sendMessage(state.activeId, text);
  const idx = state.messages.findIndex((m) => m.id === optimistic.id);
  if (idx !== -1) state.messages[idx] = sent;
  renderMessages();
}

async function openSettings() {
  const [profile, devices] = await Promise.all([
    CoreBridge.getProfile(),
    CoreBridge.listDevices(),
  ]);
  renderSettingsModal(profile, devices);
}

function renderSettingsModal(profile: Profile, devices: LinkedDevice[]) {
  const deviceRows = devices.map((d) =>
    el("div", { class: "device-row" }, [
      el("div", { class: "device-icon", text: PLATFORM_ICON[d.platform] }),
      el("div", { class: "device-info" }, [
        el("div", { class: "device-name", text: d.name }),
        el("div", {
          class: "device-sub",
          text: `Active ${d.isCurrent ? "now" : `${formatRelative(d.lastActive)} ago`}`,
        }),
      ]),
      d.isCurrent ? el("span", { class: "current-tag", text: "THIS DEVICE" }) : null,
    ])
  );

  const linkCodeBox = el("div", {});
  const linkBtn = el("button", {
    class: "link-device-btn",
    text: "+ Link a new device",
    onClick: async () => {
      linkBtn.textContent = "Generating code…";
      linkBtn.setAttribute("disabled", "true");
      const { linkCode } = await CoreBridge.beginDeviceLink();
      clear(linkCodeBox);
      linkCodeBox.append(
        el("div", { class: "link-code-box" }, [
          el("div", { class: "link-code", text: linkCode }),
          el("div", {
            class: "link-code-note",
            text: "Enter this code on the new device. It expires in 5 minutes.",
          }),
        ])
      );
      linkBtn.textContent = "+ Link a new device";
      linkBtn.removeAttribute("disabled");
    },
  });

  const modal = el(
    "div",
    {
      class: "modal-backdrop",
      onClick: (e) => {
        if (e.target === modal) modal.remove();
      },
    },
    [
      el(
        "div",
        { class: "settings-panel" },
        [
          el("div", { class: "settings-header" }, [
            el("h2", { text: "Settings" }),
            el("button", {
              class: "icon-btn",
              text: "✕",
              attrs: { "aria-label": "Close" },
              onClick: () => modal.remove(),
            }),
          ]),
          el("div", { class: "settings-section" }, [
            el("h3", { text: "Profile" }),
            el("div", { class: "profile-row" }, [
              avatar("YOU", 230, 44),
              el("div", {}, [
                el("div", { class: "profile-name", text: profile.displayName }),
                el("div", { class: "profile-username", text: profile.username }),
              ]),
            ]),
          ]),
          el("div", { class: "settings-section" }, [
            el("h3", { text: "Security" }),
            profile.pqEnabled
              ? el("span", { class: "pq-pill", text: "🛡 Post-quantum encryption active" })
              : null,
            el("div", { class: "fingerprint", text: profile.fingerprint }),
          ]),
          el("div", { class: "settings-section" }, [
            el("h3", { text: "Linked devices" }),
            ...deviceRows,
            linkBtn,
            linkCodeBox,
          ]),
        ]
      ),
    ]
  );

  document.body.append(modal);
}

async function init() {
  state.conversations = await CoreBridge.listConversations();
  state.activeId = state.conversations[0]?.id ?? null;
  renderConversationList();
  if (state.activeId) await loadMessages(state.activeId);
}

init();
