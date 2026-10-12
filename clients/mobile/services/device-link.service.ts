import { getApiBaseUrl } from "../config/api";
import { accessTokenProvider } from "./session";

export interface LinkRequestPreview { deviceName: string; platform: string; expiresAt: string }
export interface LinkedDevice { id: string; deviceName: string; platform: string; registeredAt: string | null; lastSeenAt: string | null; current: boolean }

/** A code that is not a Linqa link, or has run out of time, as something the screen can say in plain words. */
export class DeviceLinkError extends Error {
  constructor(readonly code: "NOT_A_LINK" | "LINK_NOT_FOUND" | "LINK_EXPIRED" | "LINK_NOT_PENDING" | "NETWORK" | "NOT_ALLOWED" | "UNKNOWN", message: string) {
    super(message);
    this.name = "DeviceLinkError";
  }
}

const EXPLAIN: Record<DeviceLinkError["code"], string> = {
  NOT_A_LINK: "That is not a Linqa link code.",
  LINK_NOT_FOUND: "That code is not valid. Ask the computer for a new one.",
  LINK_EXPIRED: "That code has expired. Ask the computer for a new one.",
  LINK_NOT_PENDING: "That code was already used. Ask the computer for a new one.",
  NETWORK: "No connection to Linqa. Check your network.",
  NOT_ALLOWED: "This phone is not allowed to link devices. Sign in again.",
  UNKNOWN: "Something went wrong. Try again."
};

/** What the computer shows: linqa://link?id=<link id>&s=<one-time secret>. */
export function parseLinkCode(text: string): { linkId: string; secret: string } | null {
  const match = /^linqa:\/\/link\?id=([0-9a-fA-F-]{36})&s=([A-Za-z0-9_-]{20,100})$/.exec(text.trim());
  return match ? { linkId: match[1]!, secret: match[2]! } : null;
}

async function call<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    const token = await accessTokenProvider.getAccessToken();
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: init.method ?? "POST",
      headers: { authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) })
    });
  } catch {
    throw new DeviceLinkError("NETWORK", EXPLAIN.NETWORK);
  }
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  if (response.ok) return payload as T;
  const code = payload.error?.code as DeviceLinkError["code"] | undefined;
  const known: DeviceLinkError["code"] = code && code in EXPLAIN ? code : response.status === 401 || response.status === 403 ? "NOT_ALLOWED" : "UNKNOWN";
  throw new DeviceLinkError(known, EXPLAIN[known]);
}

export const deviceLinks = {
  preview: (linkId: string, secret: string) => call<LinkRequestPreview>(`/v1/device-links/${linkId}/preview`, { body: { secret } }),
  approve: (linkId: string, secret: string) => call<void>(`/v1/device-links/${linkId}/approve`, { body: { secret } }),
  deny: (linkId: string, secret: string) => call<void>(`/v1/device-links/${linkId}/deny`, { body: { secret } }),
  list: async () => (await call<{ devices: LinkedDevice[] }>("/v1/devices", { method: "GET" })).devices,
  unlink: (deviceId: string) => call<void>(`/v1/devices/${deviceId}/unlink`)
};
