// Live alerts for photos YOU sent: viewed, screenshot, expired, revoked.
// Mount once near the root of the signed-in app:
//
//   useProtectedMediaEvents((a) => showToast(describeAlert(a)));
//
// Uses Server-Sent Events (react-native-sse). When the app is closed, alerts
// come from push notifications instead (see MediaEventsService.push on the API).

import { useEffect, useRef } from 'react';
import EventSource from 'react-native-sse';
import { getAuthToken } from '../lib/profileApi';
import { EVENTS_URL } from '../lib/protectedMedia/api';

export type SenderAlert = {
  type: 'VIEWED' | 'SCREENSHOT' | 'SCREEN_RECORDING' | 'EXHAUSTED' | 'EXPIRED' | 'CAPTURE_REVOKED';
  mediaId: string;
  conversationId: string | null;
  viewNumber?: number | null;
  remainingViews?: number | null;
  at: string;
};

type Listener = (alert: SenderAlert) => void;
const extraListeners = new Set<Listener>();

/** Lets bubbles refresh their status when an alert for their media arrives. */
export function subscribeToMediaAlerts(listener: Listener) {
  extraListeners.add(listener);
  return () => {
    extraListeners.delete(listener);
  };
}

export function describeAlert(a: SenderAlert): { title: string; body: string; urgent: boolean } {
  switch (a.type) {
    case 'VIEWED':
      return {
        title: 'Photo viewed',
        body:
          a.remainingViews === null || a.remainingViews === undefined
            ? 'Your protected photo was opened.'
            : `Your protected photo was opened (view ${a.viewNumber}, ${a.remainingViews} left).`,
        urgent: false,
      };
    case 'SCREENSHOT':
      return { title: 'Screenshot taken', body: 'Someone took a screenshot while viewing your protected photo.', urgent: true };
    case 'SCREEN_RECORDING':
      return { title: 'Screen recording detected', body: 'Your protected photo was opened while the screen was being recorded.', urgent: true };
    case 'CAPTURE_REVOKED':
      return { title: 'Access removed', body: 'Access to your photo ended because a screen capture was detected.', urgent: true };
    case 'EXHAUSTED':
      return { title: 'All views used', body: 'Your protected photo has been deleted.', urgent: false };
    case 'EXPIRED':
      return { title: 'Photo expired', body: 'The viewing window ended and your photo was deleted.', urgent: false };
  }
}

export function useProtectedMediaEvents(onAlert: Listener) {
  const handler = useRef(onAlert);
  handler.current = onAlert;

  useEffect(() => {
    let es: EventSource<'protected-media'> | null = null;
    let cancelled = false;

    (async () => {
      const token = await getAuthToken();
      if (cancelled || !token) return;
      es = new EventSource<'protected-media'>(EVENTS_URL, {
        headers: { Authorization: { toString: () => `Bearer ${token}` } },
        pollingInterval: 5000, // reconnect delay
      });
      es.addEventListener('protected-media', (event) => {
        if (!event.data) return;
        try {
          const alert = JSON.parse(event.data) as SenderAlert;
          handler.current(alert);
          extraListeners.forEach((l) => l(alert));
        } catch {
          // ignore malformed events
        }
      });
    })();

    return () => {
      cancelled = true;
      es?.removeAllEventListeners();
      es?.close();
    };
  }, []);
}
