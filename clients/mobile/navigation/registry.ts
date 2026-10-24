/**
 * Route registry for the tablet shell (sidebar + breadcrumbs).
 *
 * Pure data, no React Native imports, so it can be unit tested under Node.
 * Every `href` must be a real page under `app/` (route groups stripped);
 * tests/navigation.test.mjs checks that against the filesystem.
 */
export type NavGroup = "Connect" | "Organize" | "Discover" | "Money & Business" | "Safety & Settings";

export type NavRoute = {
  id: string;
  label: string;
  /** Landing page, as expo-router's `usePathname()` reports it. */
  href: string;
  /** Extra path prefixes that belong to this route (e.g. legacy module URLs). */
  match?: readonly string[];
  parentId?: string;
  /** Ionicons glyph name for the sidebar. */
  icon?: string;
  /** Present => listed in the sidebar under this group. */
  group?: NavGroup;
  /** Hidden unless the server reports LinqaSend/money features as available. */
  money?: boolean;
};

export const HOME_ID = "home";

export const routes: readonly NavRoute[] = [
  { id: HOME_ID, label: "Home", href: "/home", icon: "home-outline", group: "Connect" },
  { id: "chats", label: "Chats", href: "/chats", parentId: HOME_ID, icon: "chatbubbles-outline", group: "Connect" },
  { id: "calls", label: "Calls", href: "/calls", parentId: HOME_ID, icon: "call-outline", group: "Connect" },
  { id: "connections", label: "Connections", href: "/connections", parentId: HOME_ID, icon: "people-outline", group: "Connect" },
  { id: "vault", label: "LinqaVault", href: "/vault", match: ["/modules/file-vault"], parentId: HOME_ID, icon: "lock-closed-outline", group: "Organize" },
  { id: "calendar", label: "Calendar", href: "/calendar", parentId: HOME_ID, icon: "calendar-outline", group: "Organize" },
  { id: "notes", label: "Notes", href: "/notes", parentId: HOME_ID, icon: "document-text-outline", group: "Organize" },
  { id: "posts", label: "Posts", href: "/posts", parentId: HOME_ID, icon: "newspaper-outline", group: "Discover" },
  { id: "countrylinqa", label: "CountryLinqa", href: "/countrylinqa/world", match: ["/countrylinqa"], parentId: HOME_ID, icon: "globe-outline", group: "Discover" },
  { id: "communities", label: "Communities", href: "/communities", parentId: HOME_ID, icon: "people-circle-outline", group: "Discover" },
  { id: "send", label: "LinqaSend", href: "/linqasend", parentId: HOME_ID, icon: "paper-plane-outline", group: "Money & Business", money: true },
  // Wallet is its own top-level area in app/, not a child of LinqaSend.
  { id: "wallet", label: "Wallet", href: "/wallet", parentId: HOME_ID, icon: "wallet-outline", group: "Money & Business" },
  { id: "enterprise", label: "Business", href: "/enterprise", parentId: HOME_ID, icon: "business-outline", group: "Money & Business" },
  { id: "privacy", label: "Privacy", href: "/privacy-center", parentId: HOME_ID, icon: "eye-off-outline", group: "Safety & Settings" },
  { id: "devices", label: "Linked devices", href: "/linked-devices", parentId: HOME_ID, icon: "phone-portrait-outline", group: "Safety & Settings" },
  { id: "settings", label: "Settings", href: "/settings", match: ["/account/settings", "/account/manage"], parentId: HOME_ID, icon: "settings-outline", group: "Safety & Settings" },
  { id: "support", label: "Support", href: "/support", parentId: HOME_ID, icon: "help-circle-outline", group: "Safety & Settings" },
  { id: "notifications", label: "Notifications", href: "/notifications", parentId: HOME_ID },
  { id: "search", label: "Search", href: "/search", parentId: HOME_ID },
  { id: "news", label: "News", href: "/news", parentId: HOME_ID },
  { id: "messageRequests", label: "Message requests", href: "/message-requests", parentId: "chats" }
];

export const NAV_GROUPS: readonly NavGroup[] = ["Connect", "Organize", "Discover", "Money & Business", "Safety & Settings"];
