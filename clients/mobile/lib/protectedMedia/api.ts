// Client for the /protected-media API.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { API_URL, getAuthToken } from '../profileApi';
import type { ExpiryStart, ProtectionMode, ProtectionPolicy } from './policy';

export type MediaStatus = 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'REVOKED' | 'CAPTURE_REVOKED';

export type ProtectedMediaInfo = {
  id: string;
  role: 'sender' | 'recipient';
  mode: ProtectionMode;
  status: MediaStatus;
  maxViews: number | null;
  viewCount: number;
  remainingViews: number | null;
  windowSeconds: number | null;
  expiryStart: ExpiryStart | null;
  viewSeconds: number;
  notifyOnView: boolean;
  revokeOnCapture: boolean;
  createdAt: string;
  firstViewedAt: string | null;
  expiresAt: string | null;
  closedAt: string | null;
};

export type ViewGrant = {
  viewId: string;
  token: string;
  viewNumber: number;
  remainingViews: number | null;
  displaySeconds: number;
  expiresAt: string | null;
  tokenExpiresAt: string;
  revokeOnCapture: boolean;
};

export type AuditEvent = {
  seq: number;
  type: string;
  at: string;
  actor: 'sender' | 'recipient' | 'system';
  actorId: string | null;
  viewNumber: number | null;
  detail: Record<string, unknown> | null;
  hash: string;
};

export type AuditTrail = {
  media: ProtectedMediaInfo;
  integrity: { valid: true; events: number } | { valid: false; brokenAtSeq: number; reason: string };
  events: AuditEvent[];
};

export class MediaApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** For 410 responses: why access ended (EXPIRED, EXHAUSTED, ...). */
    public mediaStatus?: string,
  ) {
    super(message);
  }
}

export function clientInfo() {
  return {
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    appVersion: Constants.expoConfig?.version ?? '',
  };
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fail(res: Response): Promise<never> {
  let message = `Request failed (${res.status})`;
  let mediaStatus: string | undefined;
  try {
    const body = await res.json();
    if (typeof body?.message === 'string') message = body.message;
    if (typeof body?.status === 'string') mediaStatus = body.status;
  } catch {
    // not JSON
  }
  throw new MediaApiError(res.status, message, mediaStatus);
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}/v1/protected-media${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(await authHeaders()),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) await fail(res);
  return (await res.json()) as T;
}

/** Upload an already-encrypted file. `fileUri` points at the ciphertext on disk. */
export async function createProtectedMedia(args: {
  fileUri: string;
  recipientId: string;
  conversationId: string;
  policy: ProtectionPolicy;
}): Promise<ProtectedMediaInfo> {
  // The server takes the raw ciphertext as the body; the options ride in the query string.
  const bytes = new Uint8Array(await (await fetch(args.fileUri)).arrayBuffer());
  const query = new URLSearchParams({
    recipientId: args.recipientId,
    conversationId: args.conversationId,
    policy: JSON.stringify(args.policy),
  });
  return json<ProtectedMediaInfo>(`?${query.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
}

export const getMediaStatus = (id: string) => json<ProtectedMediaInfo>(`/${id}`);

export const requestView = (id: string) =>
  json<ViewGrant>(`/${id}/views`, { method: 'POST', body: JSON.stringify({ client: clientInfo() }) });

export async function fetchCiphertext(id: string, grant: ViewGrant): Promise<Uint8Array> {
  const res = await fetch(
    `${API_URL}/v1/protected-media/${id}/views/${grant.viewId}/blob?token=${encodeURIComponent(grant.token)}`,
    { headers: await authHeaders() },
  );
  if (!res.ok) await fail(res);
  return new Uint8Array(await res.arrayBuffer());
}

export type EndReason = 'timer' | 'closed' | 'capture' | 'background' | 'expired';

export const endView = (id: string, viewId: string, reason: EndReason) =>
  json<{ ok: boolean }>(`/${id}/views/${viewId}/end`, { method: 'POST', body: JSON.stringify({ reason }) });

export const reportCapture = (id: string, kind: 'screenshot' | 'recording', viewId?: string) =>
  json<{ revoked: boolean }>(`/${id}/capture`, {
    method: 'POST',
    body: JSON.stringify({ kind, viewId, client: clientInfo() }),
  });

export const revokeMedia = (id: string) => json<ProtectedMediaInfo>(`/${id}/revoke`, { method: 'POST' });

export const getAuditTrail = (id: string) => json<AuditTrail>(`/${id}/audit`);

