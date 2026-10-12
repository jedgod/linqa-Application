import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "../app/apiSession";
import { RawWasmCoreBridge } from "../core/RawWasmCoreBridge";
import { ChatApi } from "./chatApi";
import { clearLinkedSession, loadLinkedSession, SessionTokens } from "./linkedSession";
import { SecureMessaging } from "./secureMessaging";

export type ChatRuntime =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "ready"; userId: string; deviceId: string; api: ChatApi; core: RawWasmCoreBridge; getToken:()=>Promise<string>; messaging: SecureMessaging; peers: { current: Map<string, string[]> }; signOut: () => Promise<void> };

const KEY_PACKAGE_REFRESH_BEFORE_MS = 3 * 86_400_000;

/**
 * Brings a linked browser to life: restores its saved session, loads its own keys into the secure core, makes sure its key package
 * is published (so the phone and other people seal messages for this computer too), and hands back what the chat screen needs.
 */
export function useLinkedChat(): ChatRuntime {
  const [runtime, setRuntime] = useState<ChatRuntime>({ status: "loading" });
  const core = useRef<RawWasmCoreBridge | null>(null);

  const signOut = useCallback(async () => {
    core.current?.dispose();
    core.current = null;
    await clearLinkedSession();
    setRuntime({ status: "signed-out" });
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const session = await loadLinkedSession();
        if (!session) { if (live) setRuntime({ status: "signed-out" }); return; }
        const baseUrl = getApiBaseUrl();
        const tokens = new SessionTokens(session, baseUrl);
        const existing = sessionStorage.getItem("linqa.access.token");
        if (existing) tokens.seed(existing);

        const loaded = await RawWasmCoreBridge.load({ userId: session.userId, deviceId: session.installationId, keyStorageNamespace: session.installationId });
        loaded.setEnrolledDeviceId(session.deviceId);
        if (!live) { loaded.dispose(); return; }
        core.current = loaded;

        const api = new ChatApi(baseUrl, () => tokens.getAccessToken());
        // Publish this computer's key package when it has none or is close to running out.
        const untilKey = `linqa.web.keypackage-until.v1:${session.deviceId}`;
        const until = Number(localStorage.getItem(untilKey));
        if (!Number.isFinite(until) || until - Date.now() < KEY_PACKAGE_REFRESH_BEFORE_MS) {
          const made = await loaded.publishableKeyPackage(session.userId, session.deviceId);
          await api.publishKeyPackage(session.deviceId, made);
          localStorage.setItem(untilKey, String(Date.parse(made.expiresAt)));
          api.forgetKeyPackages(session.userId);
        }

        // The other person in each direct chat, filled in from the chat list.
        const peers = { current: new Map<string, string[]>() };
        const messaging = new SecureMessaging({
          core: loaded,
          directory: api,
          deviceId: () => session.deviceId,
          members: async (conversationId) => {
            const others = peers.current.get(conversationId);
            if (!others || others.length === 0) throw new Error("RECIPIENT_UNKNOWN");
            return [session.userId, ...others];
          }
        });
        if (live) setRuntime({ status: "ready", userId: session.userId, deviceId: session.deviceId, api, core:loaded,getToken:()=>tokens.getAccessToken(), messaging, peers, signOut });
      } catch (error) {
        if (!live) return;
        if (error instanceof Error && error.message === "SESSION_EXPIRED") { await clearLinkedSession(); setRuntime({ status: "signed-out" }); return; }
        setRuntime({ status: "error", message: error instanceof Error ? error.message : "Could not start." });
      }
    })();
    return () => { live = false; };
  }, [signOut]);

  useEffect(() => () => { core.current?.dispose(); core.current = null; }, []);
  return runtime;
}
