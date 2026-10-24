export type Note = {
  id: string;
  title: string;
  body: string;
  category: string;
  tags: string[];
  pinned: boolean;
  locked: boolean;
  created_at: string;
  updated_at: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  time_zone: string;
  location: string;
  meeting_url: string;
  recurrence: string;
  attendees: string[];
};

export type PrivacyPreferences = {
  discoverable: boolean;
  readReceipts: boolean;
  contactSync: boolean;
  personalizedRecommendations: boolean;
  updatedAt: string;
};

export function createLinqaModulesApi(apiBaseUrl: string, getAccessToken: () => Promise<string | null>) {
  const base = apiBaseUrl.replace(/\/+$/, '');

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getAccessToken();
    const response = await fetch(base + path, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error?.message || 'Linqa request failed (' + response.status + ')');
    }
    return response.status === 204 ? (undefined as T) : response.json();
  }

  return {
    notes: {
      list: () => request<{ data: Note[] }>('/notes'),
      create: (input: Partial<Note>) => request<{ data: Note }>('/notes', { method: 'POST', body: JSON.stringify(input) }),
      update: (noteId: string, patch: Partial<Note>) => request<{ data: Note }>('/notes/' + encodeURIComponent(noteId), { method: 'PATCH', body: JSON.stringify(patch) }),
      remove: (noteId: string) => request<void>('/notes/' + encodeURIComponent(noteId), { method: 'DELETE' }),
    },
    calendar: {
      list: (from?: string, to?: string) => {
        const query = new URLSearchParams();
        if (from) query.set('from', from);
        if (to) query.set('to', to);
        return request<{ data: CalendarEvent[] }>('/calendar/events' + (query.size ? '?' + query.toString() : ''));
      },
      create: (input: Omit<CalendarEvent, 'id'>) => request<{ data: CalendarEvent }>('/calendar/events', { method: 'POST', body: JSON.stringify(input) }),
      update: (eventId: string, patch: Partial<CalendarEvent>) => request<{ data: CalendarEvent }>('/calendar/events/' + encodeURIComponent(eventId), { method: 'PATCH', body: JSON.stringify(patch) }),
      remove: (eventId: string) => request<void>('/calendar/events/' + encodeURIComponent(eventId), { method: 'DELETE' }),
    },
    enterprise: {
      organizations: () => request<{ data: unknown[] }>('/enterprise/organizations'),
      detail: (orgId: string) => request<{ data: unknown }>('/enterprise/organizations/' + encodeURIComponent(orgId)),
      directory: (orgId: string) => request<{ data: unknown[] }>('/enterprise/organizations/' + encodeURIComponent(orgId) + '/directory'),
      policies: (orgId: string) => request<{ data: unknown[] }>('/enterprise/organizations/' + encodeURIComponent(orgId) + '/policies'),
      auditLog: (orgId: string) => request<{ data: unknown[] }>('/enterprise/organizations/' + encodeURIComponent(orgId) + '/audit-log'),
    },
    privacy: {
      preferences: () => request<{ data: PrivacyPreferences }>('/privacy/preferences'),
      updatePreferences: (patch: Partial<PrivacyPreferences>) => request<{ data: PrivacyPreferences }>('/privacy/preferences', { method: 'PATCH', body: JSON.stringify(patch) }),
      exportUrl: () => base + '/privacy/export',
      requestDeletion: () => request<{ data: unknown }>('/privacy/deletion-requests', { method: 'POST', body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }) }),
      latestDeletionRequest: () => request<{ data: unknown }>('/privacy/deletion-requests/latest'),
    },
  };
}
