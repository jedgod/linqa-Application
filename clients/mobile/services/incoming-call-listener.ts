import { AppState } from "react-native";
import { getApiBaseUrl } from "../config/api";
import { CallsService } from "./calls.service";
import { callController, type IncomingCall } from "./call-controller";
import { accessTokenProvider } from "./session";

type ReactNativeWebSocket = new (url: string, protocols?: string | string[], options?: { headers?: Record<string, string> }) => WebSocket;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 20_000;
const HEARTBEAT_MS = 25_000;

/**
 * Keeps this device reachable while the app is open: listens on the realtime socket for `call.incoming`, and asks the server for
 * calls already ringing whenever the socket (re)connects or the app returns to the foreground, so a ring is not lost to a gap.
 */
export function startIncomingCallListener(): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let reconnect: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const calls = new CallsService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());

  const ring = (call: IncomingCall) => { if (!stopped) callController.handleIncoming(call); };
  const catchUp = () => { void calls.incoming().then((items) => { const first = items[0]; if (first) ring(first); }).catch(() => undefined); };

  const schedule = () => {
    if (stopped || reconnect) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt) + Math.random() * 400;
    attempt = Math.min(attempt + 1, 6);
    reconnect = setTimeout(() => { reconnect = null; void connect(); }, delay);
  };

  async function connect() {
    if (stopped || socket) return;
    let token: string;
    try { token = await accessTokenProvider.getAccessToken(); } catch { schedule(); return; }
    if (stopped || socket) return;
    const url = `${getApiBaseUrl().replace(/^http/, "ws")}/v1/realtime`;
    const ws = new (WebSocket as unknown as ReactNativeWebSocket)(url, undefined, { headers: { authorization: `Bearer ${token}` } });
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
      catchUp();
      heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send("ping"); }, HEARTBEAT_MS);
    };
    ws.onmessage = (message) => {
      try {
        const frame = JSON.parse(String(message.data)) as Partial<IncomingCall> & { type?: string };
        if (frame.type === "call.incoming" && frame.callId && frame.callerDeviceId) ring(frame as IncomingCall);
      } catch { /* pong and other frames are not calls */ }
    };
    ws.onerror = () => undefined;
    ws.onclose = () => {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      if (socket === ws) socket = null;
      schedule();
    };
  }

  const appState = AppState.addEventListener("change", (state) => { if (state === "active") { void connect(); catchUp(); } });
  void connect();

  return () => {
    stopped = true;
    appState.remove();
    if (reconnect) clearTimeout(reconnect);
    if (heartbeat) clearInterval(heartbeat);
    try { socket?.close(); } catch { /* already closed */ }
    socket = null;
  };
}
