// Protection modes for photos. Mirrors api/src/protected-media/policy.ts;
// the server re-validates everything, so these limits are for the UI.

export type ProtectionMode = 'MULTI_VIEW' | 'TIMED' | 'EPHEMERAL';
export type ExpiryStart = 'ON_SEND' | 'ON_FIRST_VIEW';

export type ProtectionPolicy =
  | { mode: 'MULTI_VIEW'; maxViews: number; viewSeconds: number; notifyOnView: boolean }
  | { mode: 'TIMED'; windowSeconds: number; expiryStart: ExpiryStart; notifyOnView: boolean }
  | { mode: 'EPHEMERAL'; maxViews: 1 | 2; viewSeconds: number };

export const LIMITS = {
  MULTI_VIEW: { minViews: 1, maxViews: 10, viewSecondOptions: [5, 10, 15, 30, 60] },
  TIMED: { windowOptions: [30, 45, 60] },
  EPHEMERAL: { viewOptions: [1, 2] as const, viewSecondOptions: [3, 5, 10, 15, 30] },
} as const;

export const DEFAULT_POLICIES: Record<ProtectionMode, ProtectionPolicy> = {
  MULTI_VIEW: { mode: 'MULTI_VIEW', maxViews: 2, viewSeconds: 15, notifyOnView: true },
  TIMED: { mode: 'TIMED', windowSeconds: 30, expiryStart: 'ON_FIRST_VIEW', notifyOnView: true },
  EPHEMERAL: { mode: 'EPHEMERAL', maxViews: 1, viewSeconds: 10 },
};

export const MODE_INFO: Record<ProtectionMode, { title: string; blurb: string }> = {
  MULTI_VIEW: {
    title: 'Limited views',
    blurb: 'A set number of views. Every view is logged with the time and who opened it.',
  },
  TIMED: {
    title: 'Time limit',
    blurb: 'View as often as they like, but only inside a short window. You get notified when it is opened.',
  },
  EPHEMERAL: {
    title: 'View once',
    blurb: 'Disappears after 1 or 2 views. A screenshot or screen recording ends access right away and alerts you.',
  },
};

/** Short label for the chat bubble, e.g. "2 views", "30s after opening", "View once". */
export function policyLabel(p: {
  mode: ProtectionMode;
  maxViews?: number | null;
  windowSeconds?: number | null;
  expiryStart?: ExpiryStart | null;
}): string {
  switch (p.mode) {
    case 'MULTI_VIEW':
      return `${p.maxViews} ${p.maxViews === 1 ? 'view' : 'views'}`;
    case 'TIMED':
      return `${p.windowSeconds}s ${p.expiryStart === 'ON_SEND' ? 'from sending' : 'after opening'}`;
    case 'EPHEMERAL':
      return p.maxViews === 2 ? 'View twice' : 'View once';
  }
}
