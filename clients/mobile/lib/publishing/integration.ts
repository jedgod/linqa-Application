// Joins publishing to the rest of the app: a published post or event is added to the person's own events, so it shows under
// Upcoming on Home and Calls and in the Event log, and queued (offline) items are sent when the phone is back online.

import { getApiBaseUrl } from '../../config/api';
import { accessTokenProvider } from '../../services/session';
import { addMyEvent } from '../../services/my-events';
import { listLocalEvents, syncPublishingOutbox, type PublishingConfig } from './publishing';
import type { EventPayload } from '../../components/publishing/LinqaCreateEvent';

export const publishingConfig = (): PublishingConfig => ({
  baseUrl: getApiBaseUrl(),
  getAccessToken: () => accessTokenProvider.getAccessToken(),
});

const HOUR = 60 * 60_000;

/** Adds a confirmed item to this account's own events. The id is the server's, so adding it twice just updates it. */
export async function addToMyEvents(userId: string, remoteId: string, payload: EventPayload, kind: 'event' | 'meeting' = 'event') {
  const starts = Date.parse(payload.startsAt);
  await addMyEvent(userId, {
    id: `pub-${remoteId}`,
    kind,
    title: payload.title.slice(0, 500),
    startsAt: payload.startsAt,
    endsAt: new Date(starts + HOUR).toISOString(),
    ...(payload.location ? { place: payload.location.slice(0, 500) } : {}),
    ...(payload.description ? { note: payload.description.slice(0, 2000) } : {}),
  });
}

/** After a publish, look up the server id the outbox recorded for it and add it to the person's events. */
export async function afterPublished(userId: string, localId: string, payload: EventPayload) {
  const row = (await listLocalEvents()).find((item) => item.id === localId);
  if (row?.remoteId) await addToMyEvents(userId, row.remoteId, payload);
}

let syncing = false;
/** Sends anything that was saved while offline. Single flight: a second call while one is running does nothing. */
export async function syncAndRecord(userId: string) {
  if (syncing) return;
  syncing = true;
  try {
    const results = await syncPublishingOutbox(publishingConfig());
    const published = results.filter((r) => r.status === 'published');
    if (!published.length) return;
    const rows = await listLocalEvents();
    for (const done of published) {
      const row = rows.find((item) => item.id === done.id);
      if (row?.remoteId) await addToMyEvents(userId, row.remoteId, row.payload);
    }
  } finally {
    syncing = false;
  }
}
