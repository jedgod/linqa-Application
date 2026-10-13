// API calls for the signed-in user's username and avatar.

import * as SecureStore from 'expo-secure-store';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

/**
 * TODO: point this at wherever Linqa already keeps the JWT.
 * If you have an auth helper (for example getAccessToken()), call it here instead.
 */
export async function getAuthToken(): Promise<string | null> {
  return SecureStore.getItemAsync('linqa_jwt');
}

export type Profile = {
  id: string;
  username: string | null;
  /** Relative path such as /users/<id>/avatar?v=123, or null. */
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
  return request<Profile>('/users/me/profile');
}

export function checkUsername(username: string, signal?: AbortSignal) {
  return request<UsernameAvailability>(
    `/users/username-available?username=${encodeURIComponent(username)}`,
    { signal },
  );
}

export function updateUsername(username: string) {
  return request<Profile>('/users/me/username', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
}

export function uploadAvatar(uri: string, mimeType = 'image/jpeg') {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const form = new FormData();
  // React Native's FormData accepts { uri, name, type } for files.
  form.append('avatar', { uri, name: `avatar.${ext}`, type: mimeType } as unknown as Blob);
  // Do not set Content-Type yourself: fetch adds the multipart boundary.
  return request<Profile>('/users/me/avatar', { method: 'POST', body: form });
}

export function removeAvatar() {
  return request<Profile>('/users/me/avatar', { method: 'DELETE' });
}

/** Full URL for an avatar path returned by the API. */
export function avatarUri(path: string | null | undefined): string | null {
  return path ? `${API_URL}${path}` : null;
}
