import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, Message } from "../types";
import { CoreBridge } from "../services/CoreBridge";
import type { CoreAdapter, SecurityRuntimeState } from "../services/CoreBridge";
import { contactFor } from "../mock/data";
import { formatClock } from "../utils/format";
import { Avatar, hueFromId } from "./Avatar";
import { SafetyClient, type SafetyReportCategory } from "../safety/SafetyClient";
import { DisappearingMessageController } from "../messages/DisappearingMessageController";
import { getApiBaseUrl, getAccessToken } from "../app/apiSession";

interface ChatViewProps {
  conversation: Conversation | null;
  securityState: SecurityRuntimeState;
  onBack: () => void;
  secureAdapter: CoreAdapter;
}

const STATUS_GLYPH: Record<Message["status"], string> = {
  sending: "○",
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
};

const REPORT_CATEGORIES: SafetyReportCategory[] = [
  "HARASSMENT",
  "IMPERSONATION",
  "THREATS",
  "SCAM",
  "SEXUAL_CONTENT",
  "HATE",
  "OTHER",
];

const DISAPPEARING_TTL_MS = 24 * 60 * 60 * 1000;

function securityLabel(state: SecurityRuntimeState): string {
  switch (state.kind) {
    case "ready":
      return "🔒 End-to-end encrypted";
    case "demo":
      return "⚠ Demo — not encrypted";
    case "loading":
      return "Loading secure core…";
    default:
      return "⚠ Secure core unavailable";
  }
}

function composerPlaceholder(state: SecurityRuntimeState): string {
  switch (state.kind) {
    case "ready":
      return "Write an encrypted message";
    case "demo":
      return "Demo message — not encrypted";
    default:
      return "Secure core unavailable";
  }
}

export function ChatView({ conversation, securityState, onBack, secureAdapter }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState<SafetyReportCategory | null>(null);
  const [safetyNotice, setSafetyNotice] = useState<string | null>(null);
  const [disappearingOn, setDisappearingOn] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const safetyClient = useMemo(
    () => new SafetyClient(getApiBaseUrl(), () => Promise.resolve(getAccessToken())),
    []
  );
  const disappearing = useMemo(() => new DisappearingMessageController(), []);

  const canSend = securityState.kind === "ready" || securityState.kind === "demo";

  useEffect(() => {
    if (!conversation) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    if (securityState.kind === "ready") setMessages([]);
    else CoreBridge.listMessages(conversation.id).then((msgs) => {
      if (!cancelled) setMessages(msgs);
    });
    return () => {
      cancelled = true;
    };
  }, [conversation, securityState.kind]);

  useEffect(() => {
    if (!conversation || securityState.kind !== "ready") return;
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{messageId:string;senderUserId:string;plaintext:string}>).detail;
      if (!conversation.participantIds.includes(detail.senderUserId)) return;
      setMessages((previous) => previous.some((message) => message.id === detail.messageId) ? previous : [...previous, {
        id: detail.messageId,
        conversationId: conversation.id,
        senderId: detail.senderUserId,
        text: detail.plaintext,
        sentAt: Date.now(),
        status: "delivered",
        isMine: false
      }]);
    };
    window.addEventListener("linqa:message-received", receive);
    return () => window.removeEventListener("linqa:message-received", receive);
  }, [conversation, securityState.kind]);

  useEffect(() => {
    setMenuOpen(false);
    setReportCategory(null);
    setSafetyNotice(null);
    setDisappearingOn(false);
    disappearing.clear();
  }, [conversation?.id, disappearing]);

  useEffect(() => () => disappearing.clear(), [disappearing]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  if (!conversation) {
    return (
      <div className="chat-view">
        <div className="chat-empty">Select a conversation</div>
      </div>
    );
  }

  const single = !conversation.isGroup ? contactFor(conversation.participantIds[0]) : undefined;

  async function handleSend() {
    const text = draft.trim();
    if (!text || !conversation || !canSend) return;
    setDraft("");
    const optimistic: Message = {
      id: `pending-${Date.now()}`,
      conversationId: conversation.id,
      senderId: "me",
      text,
      sentAt: Date.now(),
      status: "sending",
      isMine: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    if (securityState.kind === "ready") {
      try {
        await secureAdapter.sendMessage({
          conversationId: conversation.id,
          clientMessageId: optimistic.id,
          recipientUserId: single?.id,
          body: text
        });
        const sent = { ...optimistic, status: "sent" as const };
        setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? sent : m)));
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setSafetyNotice("Encrypted delivery failed; the message was not sent.");
      }
      return;
    }
    const sent = await CoreBridge.sendMessage(conversation.id, text);
    setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? sent : m)));
    if (disappearingOn) {
      disappearing.schedule({
        messageId: sent.id,
        expiresAt: new Date(Date.now() + DISAPPEARING_TTL_MS).toISOString(),
        onExpire: (messageId) => setMessages((prev) => prev.filter((m) => m.id !== messageId)),
      });
    }
  }

  async function handleBlock() {
    if (!single) return;
    setMenuOpen(false);
    try {
      await safetyClient.block(single.id);
      setSafetyNotice(`Blocked ${single.displayName}.`);
    } catch {
      setSafetyNotice("Unable to block right now.");
    }
  }

  async function handleReport(category: SafetyReportCategory) {
    if (!single) return;
    try {
      await safetyClient.report({ reportedUserId: single.id, category, description: `Reported from chat with ${single.displayName}` });
      setSafetyNotice("Report submitted.");
    } catch {
      setSafetyNotice("Unable to submit report right now.");
    } finally {
      setReportCategory(null);
      setMenuOpen(false);
    }
  }

  return (
    <div className="chat-view">
      <div className="chat-header">
        <button className="mobile-back-button icon-btn" onClick={onBack} aria-label="Back to conversations">
          ←
        </button>
        <Avatar
          initials={single?.initials ?? conversation.title.slice(0, 2).toUpperCase()}
          hue={single?.colorHue ?? hueFromId(conversation.id)}
          size={34}
        />
        <div>
          <div className="chat-header-title">{conversation.title}</div>
          <div className="chat-header-sub">
            {securityLabel(securityState)}
            {single ? (single.online ? " · Online" : "") : ` · ${conversation.participantIds.length} members`}
          </div>
        </div>
        <button
          className="icon-btn"
          onClick={() => setDisappearingOn((v) => !v)}
          title={disappearingOn ? "Disappearing messages: on (24h)" : "Disappearing messages: off"}
          aria-label="Toggle disappearing messages"
          aria-pressed={disappearingOn}
        >
          {disappearingOn ? "⏱" : "⏱"}
        </button>
        {single && (
          <div style={{ position: "relative" }}>
            <button className="icon-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Conversation options">
              ⋯
            </button>
            {menuOpen && (
              <div className="settings-panel" style={{ position: "absolute", right: 0, top: "100%", zIndex: 5, minWidth: 180 }}>
                <button onClick={handleBlock}>Block {single.displayName}</button>
                <button onClick={() => setReportCategory(REPORT_CATEGORIES[0])}>Report {single.displayName}</button>
                {reportCategory && (
                  <div>
                    <select value={reportCategory} onChange={(e) => setReportCategory(e.target.value as SafetyReportCategory)}>
                      {REPORT_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => handleReport(reportCategory)}>Submit report</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {safetyNotice && (
        <div role="status" className="chat-header-sub">
          {safetyNotice}
        </div>
      )}

      <div className="message-list" ref={listRef}>
        {messages.map((m) => (
          <div key={m.id} className={`message-row ${m.isMine ? "mine" : "theirs"}`}>
            <div className={`bubble ${m.isMine ? "mine" : "theirs"}`}>
              {m.text}
              <span className="bubble-meta">
                {formatClock(m.sentAt)}
                {m.isMine ? `  ${STATUS_GLYPH[m.status]}` : ""}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="composer">
        <input
          placeholder={composerPlaceholder(securityState)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!canSend}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
        />
        <button className="send-btn" onClick={handleSend} disabled={!canSend || !draft.trim()} aria-label="Send">
          ➤
        </button>
      </div>
    </div>
  );
}
