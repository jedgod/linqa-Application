export interface Contact {
  id: string;
  displayName: string;
  initials: string;
  colorHue: number;
  online: boolean;
  fingerprint: string;
}

export type MessageStatus = "sending" | "sent" | "delivered" | "read";

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  sentAt: number;
  status: MessageStatus;
  isMine: boolean;
}

export interface Conversation {
  id: string;
  isGroup: boolean;
  title: string;
  participantIds: string[];
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
}

export type DevicePlatform = "android" | "ios" | "desktop" | "web";

export interface LinkedDevice {
  id: string;
  name: string;
  platform: DevicePlatform;
  linkedAt: number;
  lastActive: number;
  isCurrent: boolean;
}

export interface Profile {
  displayName: string;
  username: string;
  fingerprint: string;
  pqEnabled: boolean;
}
