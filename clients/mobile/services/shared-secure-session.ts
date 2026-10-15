import { AccountSecureStorage } from "../account/AccountSecureStorage";
import { getApiBaseUrl } from "../config/api";
import { secureCoreModule } from "../modules/linqa-secure-core";
import { SecureCoreDevice, SecureCoreMessaging } from "./secure-core";
import { SecureCoreServer } from "./secure-core-server";
import { accessTokenProvider } from "./session";
import { registerAccountScopeReset } from "./account-scope";

/**
 * One secure messaging session per account, shared by every screen that opens messages (a conversation, the chat list previews).
 *
 * The core refuses to open the same envelope twice, and `SecureCoreMessaging` remembers what it has opened in memory. If the chat
 * list and a conversation each had their own session, a message opened for a preview could then fail to open in the conversation.
 * Sharing one session means a message is opened once and reused.
 */
const storage = new AccountSecureStorage();

/** Legacy UI hints. Message encryption reads current membership from the server. */
export const sendPeer: { current: string | null } = { current: null };
/** Legacy group UI hint; not the source of encryption recipients. */
export const sendGroup: { current: string[] | null } = { current: null };

export interface SharedSecure {
  device: SecureCoreDevice;
  server: SecureCoreServer;
  store: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
  messaging: SecureCoreMessaging;
}

const sessions = new Map<string, SharedSecure | null>();
// The native module holds one core. A session's readiness cannot survive
// switching which account's keys that core has loaded.
registerAccountScopeReset('secure-session',()=>{sessions.clear();sendPeer.current=null;sendGroup.current=null;});

export function sharedSecureSession(selfId: string): SharedSecure | null {
  if (!selfId) return null;
  if (sessions.has(selfId)) return sessions.get(selfId) ?? null;
  const bridge = secureCoreModule();
  if (!bridge) { sessions.set(selfId, null); return null; }
  const store = { protectionLevel: () => storage.protectionLevel(), get: (key: string) => storage.get(selfId, key), put: (key: string, value: string) => storage.put(selfId, key, value) };
  const server = new SecureCoreServer(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());
  const device = new SecureCoreDevice(bridge, store, selfId);
  const messaging = new SecureCoreMessaging({
    bridge, device, directory: server,
    members: (conversationId) => server.conversationMembers(conversationId)
  });
  const created = { device, server, store, messaging };
  sessions.set(selfId, created);
  return created;
}

/** Forget an account's session (sign out), so a later sign-in builds a fresh one. */
export function dropSharedSecureSession(selfId: string): void { sessions.delete(selfId); }
