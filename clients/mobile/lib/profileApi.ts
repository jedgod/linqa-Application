// API calls for the signed-in user's username and avatar (server/src/routes/profile.ts).

import { getApiBaseUrl } from '../config/api';
import { accessTokenProvider } from '../services/session';

export const API_URL = getApiBaseUrl();

/** The active account's access token; avatars need it in an Authorization header. */
export async function getAuthToken(): Promise<string | null> {
  try {
    return await accessTokenProvider.getAccessToken();
  } catch {
    return null;
  }
}

export type Profile = {
  id: string;
  username: string | null;
  /** Relative path such as /v1/profile/<id>/avatar?v=123, or null. */
  avatarUrl: string | null;
};

export type UsernameAvailability = {
  username: string;
  available: boolean;
  reason?: string;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.message === 'string') message = body.message;
      else if (Array.isArray(body?.message)) message = body.message.join(' ');
    } catch {
      // Body was not JSON.
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export function fetchProfile() {
  return request<Profile>('/v1/profile/me');
}

export function checkUsername(username: string, signal?: AbortSignal) {
  return request<UsernameAvailability>(
    `/v1/profile/username-available?username=${encodeURIComponent(username)}`,
    { signal },
  );
}

export function updateUsername(username: string) {
  return request<Profile>('/v1/profile/username', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
}

export async function uploadAvatar(uri: string, mimeType = 'image/jpeg') {
  const type = mimeType === 'image/png' || mimeType === 'image/webp' ? mimeType : 'image/jpeg';
  // The server takes the raw image bytes as the request body. Raw bytes, not a Blob: React Native
  // lets a Blob's own type override the Content-Type header.
  const bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer());
  return request<Profile>('/v1/profile/avatar', {
    method: 'PUT',
    headers: { 'Content-Type': type },
    body: bytes,
  });
}

export function removeAvatar() {
  return request<Profile>('/v1/profile/avatar', { method: 'DELETE' });
}

/** Full URL for an avatar path returned by the API. */
export function avatarUri(path: string | null | undefined): string | null {
  return path ? `${API_URL}${path}` : null;
}
