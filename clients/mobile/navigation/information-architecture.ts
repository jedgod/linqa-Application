import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";

export type LinqaIcon = ComponentProps<typeof Ionicons>["name"];

export type CreateActionKey =
  | "chat" | "group" | "call" | "video" | "schedule" | "call-link"
  | "secure-file" | "ai" | "send" | "request" | "recipient" | "payment"
  | "save" | "scan" | "intake" | "folder" | "event" | "post" | "live"
  | "note" | "reminder" | "community-event";

export type CreateAction = {
  key: CreateActionKey;
  label: string;
  icon: LinqaIcon;
  route: string;
};

const action = (key: CreateActionKey, label: string, icon: LinqaIcon, route: string): CreateAction => ({
  key, label, icon, route
});

export const GLOBAL_CREATE_ACTIONS: readonly CreateAction[] = [
  action("chat", "New chat", "chatbubble-outline", "/(tabs)/chats"),
  action("call", "New call", "call-outline", "/(tabs)/calls"),
  action("send", "Send money", "paper-plane-outline", "/linqasend"),
  action("save", "Save to Vault", "lock-closed-outline", "/modules/file-vault"),
  action("event", "Create event", "calendar-outline", "/countrylinqa/create?type=event"),
  action("post", "Create post", "create-outline", "/countrylinqa/create?type=post"),
  action("note", "New note", "document-text-outline", "/modules/notes"),
  action("group", "New group", "people-outline", "/modules/chats")
];

const CONTEXT_ACTIONS: Record<string, readonly CreateAction[]> = {
  // Only the three call actions the API actually supports. "Group call" and
  // "Create call link" were listed here but `POST /v1/calls` creates exactly
  // one CALLER and one CALLEE (1:1), and there is no call-link feature on the
  // server at all -- both routed to the generic module placeholder. The Calls
  // screen handles these keys in place rather than navigating, so `route` is
  // only a fallback for other surfaces.
  calls: [
    action("call", "Audio call", "call-outline", "/(tabs)/calls"),
    action("video", "Video call", "videocam-outline", "/(tabs)/calls"),
    action("schedule", "Schedule call", "calendar-outline", "/(tabs)/calls")
  ],
  chats: [
    action("chat", "New chat", "chatbubble-outline", "/(tabs)/chats"),
    action("group", "New group", "people-outline", "/modules/chats"),
    action("secure-file", "Secure file", "shield-checkmark-outline", "/modules/file-vault"),
    action("ai", "Ask Linqa AI", "sparkles-outline", "/modules/ai")
  ],
  vault: [
    action("save", "Upload file", "cloud-upload-outline", "/modules/file-vault"),
    action("scan", "Scan document", "scan-outline", "/modules/file-vault"),
    action("intake", "Social intake", "share-social-outline", "/modules/file-vault"),
    action("folder", "New folder", "folder-open-outline", "/modules/file-vault")
  ],
  send: [
    action("send", "Send money", "paper-plane-outline", "/linqasend"),
    action("request", "Request money", "download-outline", "/linqasend"),
    action("recipient", "Add recipient", "person-add-outline", "/linqasend"),
    action("payment", "Payment method", "card-outline", "/linqasend")
  ],
  calendar: [
    action("event", "New event", "calendar-outline", "/modules/calendar"),
    action("schedule", "Scheduled call", "call-outline", "/modules/calendar"),
    action("reminder", "Reminder", "alarm-outline", "/modules/calendar"),
    action("community-event", "Community event", "people-outline", "/countrylinqa/create?type=event")
  ],
  discover: [
    action("post", "Create post", "create-outline", "/countrylinqa/create?type=post"),
    action("group", "Community", "people-outline", "/(tabs)/communities"),
    action("event", "Event", "calendar-outline", "/countrylinqa/create?type=event"),
    action("live", "Share live update", "radio-outline", "/countrylinqa/create?type=post")
  ]
};

export function createActionsForPath(pathname: string): readonly CreateAction[] {
  if (pathname.includes("calls")) return CONTEXT_ACTIONS.calls;
  if (pathname.includes("chats")) return CONTEXT_ACTIONS.chats;
  if (pathname.includes("file-vault") || pathname.includes("vault")) return CONTEXT_ACTIONS.vault;
  if (pathname.includes("linqasend") || pathname.includes("send")) return CONTEXT_ACTIONS.send;
  if (pathname.includes("calendar")) return CONTEXT_ACTIONS.calendar;
  if (pathname.includes("countrylinqa") || pathname.includes("communities")) return CONTEXT_ACTIONS.discover;
  return GLOBAL_CREATE_ACTIONS;
}

export type HubService = {
  key: string;
  title: string;
  description: string;
  icon: LinqaIcon;
  color: string;
  route: string;
  group: "Connect" | "Organize" | "Discover" | "Money & Business" | "Safety & Settings";
};

export const LINQA_HUB_SERVICES: readonly HubService[] = [
  { key: "chats", title: "Chats", description: "Messages, groups and requests", icon: "chatbubbles-outline", color: "#5B4CFF", route: "/(tabs)/chats", group: "Connect" },
  { key: "calls", title: "Calls", description: "Audio, video and scheduled calls", icon: "call-outline", color: "#16B874", route: "/(tabs)/calls", group: "Connect" },
  { key: "contacts", title: "Contacts", description: "People, trusted and blocked lists", icon: "people-outline", color: "#00AFC8", route: "/modules/contacts", group: "Connect" },
  { key: "vault", title: "LinqaVault", description: "Private files, scans and notes", icon: "lock-closed-outline", color: "#5966E9", route: "/modules/file-vault", group: "Organize" },
  { key: "calendar", title: "Calendar", description: "Events, calls and reminders", icon: "calendar-outline", color: "#E53E78", route: "/modules/calendar", group: "Organize" },
  { key: "notes", title: "Notes", description: "Secure notes and checklists", icon: "document-text-outline", color: "#F49A23", route: "/modules/notes", group: "Organize" },
  { key: "countrylinqa", title: "CountryLinqa", description: "Local communities and global discovery", icon: "globe-outline", color: "#7457F5", route: "/countrylinqa/world", group: "Discover" },
  { key: "communities", title: "Communities", description: "Groups, events and live discussions", icon: "people-circle-outline", color: "#13BFA6", route: "/(tabs)/communities", group: "Discover" },
  { key: "status", title: "Status & Posts", description: "Share updates with your audience", icon: "radio-outline", color: "#EE4778", route: "/modules/status", group: "Discover" },
  { key: "send", title: "LinqaSend", description: "Transfers, recipients and activity", icon: "paper-plane-outline", color: "#E86B22", route: "/linqasend", group: "Money & Business" },
  { key: "wallet", title: "Wallet", description: "Cards, passes and identity", icon: "wallet-outline", color: "#4F6EF7", route: "/modules/wallet", group: "Money & Business" },
  { key: "enterprise", title: "Business", description: "Teams, policies and administration", icon: "business-outline", color: "#344563", route: "/modules/enterprise", group: "Money & Business" },
  { key: "privacy", title: "Privacy", description: "Audience and data controls", icon: "eye-off-outline", color: "#5966E9", route: "/privacy-center", group: "Safety & Settings" },
  { key: "security", title: "Security", description: "Devices, passkeys and encryption", icon: "shield-checkmark-outline", color: "#11A778", route: "/modules/security", group: "Safety & Settings" },
  { key: "settings", title: "Settings", description: "Account, storage and accessibility", icon: "settings-outline", color: "#65758B", route: "/(tabs)/settings", group: "Safety & Settings" }
];

export const HUB_GROUPS = ["Connect", "Organize", "Discover", "Money & Business", "Safety & Settings"] as const;
