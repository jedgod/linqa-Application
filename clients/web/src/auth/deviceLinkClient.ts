/**
 * The computer's side of linking by QR code. It asks the server for a one-time link, shows it as a QR code for the phone to scan,
 * waits for the phone to approve, then claims its enrollment session once. No account details are typed on this computer.
 */
export type LinkStatus = "PENDING" | "APPROVED" | "CLAIMED" | "DENIED" | "EXPIRED";

export interface LinkRequest { linkId: string; secret: string; expiresAt: string; qrText: string }

export interface TemporarySession {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
}

export class DeviceLinkClientError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DeviceLinkClientError";
  }
}

/** "Chrome on Windows": what the phone shows when it asks the person to approve. */
export function describeBrowser(userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /OPR\//.test(userAgent) ? "Opera" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const system = /Windows/.test(userAgent) ? "Windows" : /Mac OS X|Macintosh/.test(userAgent) ? "Mac" : /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Linux/.test(userAgent) ? "Linux" : "computer";
  return `${browser} on ${system}`;
}

export function qrTextFor(linkId: string, secret: string): string {
  return `linqa://link?id=${linkId}&s=${secret}`;
}

async function post<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new DeviceLinkClientError("NETWORK");
  }
  const payload = (await response.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  if (!response.ok) throw new DeviceLinkClientError(payload.error?.code ?? `HTTP_${response.status}`);
  return payload as T;
}

export const deviceLinkClient = {
  async create(baseUrl: string, deviceName = describeBrowser()): Promise<LinkRequest> {
    const created = await post<{ linkId: string; secret: string; expiresAt: string }>(baseUrl, "/v1/device-links", { deviceName, platform: "WEB" });
    return { ...created, qrText: qrTextFor(created.linkId, created.secret) };
  },
  async status(baseUrl: string, link: Pick<LinkRequest, "linkId" | "secret">): Promise<LinkStatus> {
    return (await post<{ status: LinkStatus }>(baseUrl, `/v1/device-links/${link.linkId}/status`, { secret: link.secret })).status;
  },
  async claim(baseUrl: string, link: Pick<LinkRequest, "linkId" | "secret">): Promise<TemporarySession> {
    return (await post<{ session: TemporarySession }>(baseUrl, `/v1/device-links/${link.linkId}/claim`, { secret: link.secret })).session;
  }
};
