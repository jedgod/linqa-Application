import { useMemo, useState } from "react";
import type { Conversation } from "../types";
import { contactFor, conversationSubtitle, lastMessageTime } from "../mock/data";
import { formatRelative } from "../utils/format";
import { Avatar, hueFromId } from "./Avatar";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
  onOpenCalls: () => void;
  onOpenMedia: () => void;
  onOpenPrivacy: () => void;
  onOpenVault: () => void;
  onOpenCountryLinqa?: () => void;
  onOpenOperations?: () => void;
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onOpenSettings,
  onOpenCalls,
  onOpenMedia,
  onOpenPrivacy,
  onOpenVault,
  onOpenCountryLinqa,
  onOpenOperations
}: SidebarProps) {
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => {
    const filtered = conversations.filter((c) =>
      c.title.toLowerCase().includes(query.toLowerCase())
    );
    return [...filtered].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return lastMessageTime(b.id) - lastMessageTime(a.id);
    });
  }, [conversations, query]);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <Avatar initials="YOU" hue={230} size={34} />
        <div className="brand">Linqa</div>
        <button className="icon-btn" onClick={onOpenCalls} title="Calls" aria-label="Calls">
          📞
        </button>
        <button className="icon-btn" onClick={onOpenMedia} title="Media" aria-label="Media">
          🖼
        </button>
        <button className="icon-btn" onClick={onOpenPrivacy} title="Privacy Center" aria-label="Privacy Center">
          🛡
        </button>
        <button className="icon-btn" onClick={onOpenVault} title="File Vault" aria-label="File Vault">
          🔒
        </button>
        {onOpenOperations && (
          <button className="icon-btn" onClick={onOpenOperations} title="Operations" aria-label="Operations">
            🧑‍💼
          </button>
        )}
        <button className="icon-btn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
          ⚙
        </button>
      </div>

      {onOpenCountryLinqa && <button className="countrylinqa-entry" onClick={onOpenCountryLinqa} aria-label="Open CountryLinqa">🌐 CountryLinqa</button>}
      <div className="search-box">
        <input
          placeholder="Search conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="conversation-list">
        {sorted.map((c) => {
          const single = !c.isGroup ? contactFor(c.participantIds[0]) : undefined;
          const hue = single?.colorHue ?? hueFromId(c.id);
          const initials = single?.initials ?? c.title.slice(0, 2).toUpperCase();
          return (
            <button
              key={c.id}
              className={`conversation-item${c.id === activeId ? " active" : ""}`}
              onClick={() => onSelect(c.id)}
            >
              <Avatar initials={initials} hue={hue} />
              <div className="conversation-meta">
                <div className="conversation-title-row">
                  <span className="conversation-title">{c.title}</span>
                  <span className="conversation-time">
                    {formatRelative(lastMessageTime(c.id))}
                  </span>
                </div>
                <div className="conversation-subtitle-row">
                  <span className="conversation-subtitle">
                    {conversationSubtitle(c.id)}
                  </span>
                  {c.unreadCount > 0 && (
                    <span className="unread-badge">{c.unreadCount}</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
        {sorted.length === 0 && (
          <div style={{ padding: "16px", color: "var(--text-faint)", fontSize: "0.85rem" }}>
            No conversations match "{query}"
          </div>
        )}
      </div>
    </div>
  );
}
