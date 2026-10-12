import { WebCryptoKeyProvider } from "../security/WebCryptoKeyProvider";

/**
 * What a linked browser keeps so it stays linked after a reload: who it is, its device id, and the refresh token for its session.
 * The refresh token is never stored readable. It is sealed with a key that lives in the browser's key store and cannot be exported,
 * so reading the saved value off the disk gives nothing. Signing out removes all of it.
 */
const STORAGE_KEY = "linqa.web.linked-session.v1";
const KEY_ALIAS = "linqa-web-session-key";
const CONTEXT = new TextEncoder().encode("linqa:web-linked-session:v1");

export interface LinkedSession {
  userId: string;
  /** The device id the server gave this browser when it enrolled. */
  deviceId: string;
  /** The id this browser's core keys are stored under. */
  installationId: string;
  refreshToken: string;
}

const NAME_KEY = "linqa.web.computer-name.v1";
/** The name this computer shows (and the phone shows in Linked devices). */
export function getComputerName(): string {
  try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; }
}
export function setComputerName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name.trim().slice(0, 60)); } catch { /* the name is only cosmetic */ }
}

export class SessionExpiredError extends Error {
  constructor() { super("SESSION_EXPIRED"); this.name = "SessionExpiredError"; }
}

const keys = new WebCryptoKeyProvider();
const toBase64 = (bytes: Uint8Array) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export async function saveLinkedSession(session: LinkedSession): Promise<void> {
  await keys.createWrappingKey(KEY_ALIAS);
  const wrapped = await keys.wrapKey({ alias: KEY_ALIAS, rawKey: new TextEncoder().encode(session.refreshToken), context: CONTEXT });
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId: session.userId, deviceId: session.deviceId, installationId: session.installationId, sealed: toBase64(wrapped) }));
}

export async function loadLinkedSession(): Promise<LinkedSession | null> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { userId?: string; deviceId?: string; installationId?: string; sealed?: string };
    if (!saved.userId || !saved.deviceId || !saved.installationId || !saved.sealed) return null;
    const token = new TextDecoder().decode(await keys.unwrapKey({ alias: KEY_ALIAS, wrappedKey: fromBase64(saved.sealed), context: CONTEXT }));
    return { userId: saved.userId, deviceId: saved.deviceId, installationId: saved.installationId, refreshToken: token };
  } catch {
    return null;
  }
}

export async function clearLinkedSession(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY);
  try { await keys.deleteKey(KEY_ALIAS); } catch { /* nothing to delete */ }
  sessionStorage.removeItem("linqa.auth.runtime");
  sessionStorage.removeItem("linqa.access.token");
  window.dispatchEvent(new Event("linqa:runtime-changed"));
}

function expiryOf(jwt: string): number {
  try {
    const part = jwt.split(".")[1] ?? "";
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
    return typeof json.exp === "number" ? json.exp * 1000 : 0;
  } catch { return 0; }
}

/** Hands out a valid access token, refreshing (and rotating the refresh token) when the current one is about to run out. */
export class SessionTokens {
  private access = "";
  private inFlight: Promise<string> | null = null;

  constructor(private session: LinkedSession, private readonly baseUrl: string) {}

  seed(accessToken: string) { this.access = accessToken; }

  async getAccessToken(): Promise<string> {
    if (this.access && expiryOf(this.access) - Date.now() > 60_000) return this.access;
    this.inFlight ??= this.refresh().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async refresh(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/auth/sessions/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: this.session.refreshToken }) });
    } catch {
      throw new Error("NETWORK");
    }
    if (response.status === 401 || response.status === 403 || response.status === 400) throw new SessionExpiredError();
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const next = (await response.json()) as { accessToken: string; refreshToken: string };
    this.access = next.accessToken;
    this.session = { ...this.session, refreshToken: next.refreshToken };
    await saveLinkedSession(this.session);
    sessionStorage.setItem("linqa.access.token", next.accessToken);
    return this.access;
  }
}
