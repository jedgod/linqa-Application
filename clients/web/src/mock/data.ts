import type {
  Contact,
  Conversation,
  LinkedDevice,
  Message,
  Profile,
} from "../types";

// In-memory mock data standing in for linqa-core. Nothing here is persisted
// or encrypted — it exists purely so the UI shell has something to render
// before the real Rust core is buildable.

export const ME_ID = "me";

export const profile: Profile = {
  displayName: "You",
  username: "@you.linqa",
  fingerprint: "8F2C 91AA 4D6E 0B77 1F3A  6C90 2E5D 44B1",
  pqEnabled: true,
};

export const contacts: Contact[] = [
  { id: "u-avery", displayName: "Avery Chen", initials: "AC", colorHue: 262, online: true, fingerprint: "3A1B 77CE 90F2 118D" },
  { id: "u-lin", displayName: "Lin Ochoa", initials: "LO", colorHue: 199, online: false, fingerprint: "5D40 22AB CC91 7702" },
  { id: "u-priya", displayName: "Priya Nair", initials: "PN", colorHue: 154, online: true, fingerprint: "F013 9BDE 4471 A0C2" },
  { id: "u-marcus", displayName: "Marcus Webb", initials: "MW", colorHue: 24, online: false, fingerprint: "77AC 0FE1 2D8B 5599" },
  { id: "u-sana", displayName: "Sana Rehman", initials: "SR", colorHue: 330, online: true, fingerprint: "B821 4471 0E9C 3FA0" },
];

export const conversations: Conversation[] = [
  { id: "c-avery", isGroup: false, title: "Avery Chen", participantIds: ["u-avery"], unreadCount: 2, pinned: true, muted: false },
  { id: "c-design", isGroup: true, title: "Design Sync", participantIds: ["u-lin", "u-priya", "u-marcus"], unreadCount: 0, pinned: false, muted: false },
  { id: "c-lin", isGroup: false, title: "Lin Ochoa", participantIds: ["u-lin"], unreadCount: 0, pinned: false, muted: false },
  { id: "c-priya", isGroup: false, title: "Priya Nair", participantIds: ["u-priya"], unreadCount: 5, pinned: false, muted: false },
  { id: "c-sana", isGroup: false, title: "Sana Rehman", participantIds: ["u-sana"], unreadCount: 0, pinned: false, muted: true },
];

const now = Date.now();
const min = 60_000;

export const messagesByConversation: Record<string, Message[]> = {
  "c-avery": [
    { id: "m1", conversationId: "c-avery", senderId: "u-avery", text: "Hey, did the new build land?", sentAt: now - 42 * min, status: "read", isMine: false },
    { id: "m2", conversationId: "c-avery", senderId: ME_ID, text: "Yep, just pushed. Should be up in ~10 min.", sentAt: now - 40 * min, status: "read", isMine: true },
    { id: "m3", conversationId: "c-avery", senderId: "u-avery", text: "Nice. Are the PQC handshake changes in this one?", sentAt: now - 12 * min, status: "read", isMine: false },
    { id: "m4", conversationId: "c-avery", senderId: "u-avery", text: "Also — can you sanity check the device linking flow before we ship?", sentAt: now - 3 * min, status: "read", isMine: false },
  ],
  "c-design": [
    { id: "m5", conversationId: "c-design", senderId: "u-lin", text: "Updated the chat bubble spacing in the latest Figma.", sentAt: now - 3 * 60 * min, status: "read", isMine: false },
    { id: "m6", conversationId: "c-design", senderId: "u-priya", text: "Looks good, one nit on the unread badge color.", sentAt: now - 2 * 60 * min, status: "read", isMine: false },
    { id: "m7", conversationId: "c-design", senderId: ME_ID, text: "Fixed, pushing a new export now.", sentAt: now - 90 * min, status: "delivered", isMine: true },
  ],
  "c-lin": [
    { id: "m8", conversationId: "c-lin", senderId: "u-lin", text: "Lunch tomorrow?", sentAt: now - 26 * 60 * min, status: "read", isMine: false },
    { id: "m9", conversationId: "c-lin", senderId: ME_ID, text: "Sure, noon works.", sentAt: now - 25 * 60 * min, status: "read", isMine: true },
  ],
  "c-priya": [
    { id: "m10", conversationId: "c-priya", senderId: "u-priya", text: "Sent you the audit notes.", sentAt: now - 5 * 60 * min, status: "read", isMine: false },
    { id: "m11", conversationId: "c-priya", senderId: "u-priya", text: "Section 4 has the sealed-sender questions.", sentAt: now - 4 * 60 * min, status: "read", isMine: false },
    { id: "m12", conversationId: "c-priya", senderId: "u-priya", text: "No rush, just flagging before Friday.", sentAt: now - 4 * 60 * min, status: "read", isMine: false },
    { id: "m13", conversationId: "c-priya", senderId: "u-priya", text: "Also — new fingerprint after your reinstall, verify when you get a sec.", sentAt: now - 20 * min, status: "read", isMine: false },
    { id: "m14", conversationId: "c-priya", senderId: "u-priya", text: "🔒", sentAt: now - 19 * min, status: "read", isMine: false },
  ],
  "c-sana": [
    { id: "m15", conversationId: "c-sana", senderId: "u-sana", text: "Meeting moved to 3pm.", sentAt: now - 26 * 60 * 60 * min, status: "read", isMine: false },
  ],
};

export const devices: LinkedDevice[] = [
  { id: "d-current", name: "This browser", platform: "web", linkedAt: now - 30 * 24 * 60 * min, lastActive: now, isCurrent: true },
  { id: "d-phone", name: "Pixel 9", platform: "android", linkedAt: now - 30 * 24 * 60 * min, lastActive: now - 5 * min, isCurrent: false },
  { id: "d-laptop", name: "MacBook Pro", platform: "desktop", linkedAt: now - 12 * 24 * 60 * min, lastActive: now - 3 * 60 * min, isCurrent: false },
];

export function contactFor(id: string): Contact | undefined {
  return contacts.find((c) => c.id === id);
}

export function conversationSubtitle(conversationId: string): string {
  const msgs = messagesByConversation[conversationId] ?? [];
  const last = msgs[msgs.length - 1];
  if (!last) return "No messages yet";
  const prefix = last.isMine ? "You: " : "";
  return `${prefix}${last.text}`;
}

export function lastMessageTime(conversationId: string): number {
  const msgs = messagesByConversation[conversationId] ?? [];
  return msgs[msgs.length - 1]?.sentAt ?? 0;
}
