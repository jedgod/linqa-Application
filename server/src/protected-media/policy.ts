// Validation for the three protection modes. The mobile app has a matching
// copy in lib/protectedMedia/policy.ts; the server is the one that counts.

export type Mode = 'MULTI_VIEW' | 'TIMED' | 'EPHEMERAL';
export type Start = 'ON_SEND' | 'ON_FIRST_VIEW';

export type PolicyInput = {
  mode?: unknown;
  maxViews?: unknown;
  windowSeconds?: unknown;
  expiryStart?: unknown;
  viewSeconds?: unknown;
  notifyOnView?: unknown;
};

export type Policy = {
  mode: Mode;
  maxViews: number | null;
  windowSeconds: number | null;
  expiryStart: Start | null;
  viewSeconds: number;
  notifyOnView: boolean;
  revokeOnCapture: boolean;
};

/** Limits per mode. Change these to make the rules stricter or looser. */
export const LIMITS = {
  MULTI_VIEW: { minViews: 1, maxViews: 10, defaultViews: 2, minViewSec: 5, maxViewSec: 60, defaultViewSec: 15 },
  TIMED: { minWindowSec: 30, maxWindowSec: 60, defaultWindowSec: 30 },
  EPHEMERAL: { minViews: 1, maxViews: 2, defaultViews: 1, minViewSec: 3, maxViewSec: 30, defaultViewSec: 10 },
} as const;

export class PolicyError extends Error {}

function int(v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new PolicyError('Numbers must be whole numbers.');
  return n;
}

function inRange(n: number, min: number, max: number, what: string) {
  if (n < min || n > max) throw new PolicyError(`${what} must be between ${min} and ${max}.`);
  return n;
}

export function parsePolicy(input: PolicyInput): Policy {
  switch (input.mode) {
    case 'MULTI_VIEW': {
      const L = LIMITS.MULTI_VIEW;
      return {
        mode: 'MULTI_VIEW',
        maxViews: inRange(int(input.maxViews, L.defaultViews), L.minViews, L.maxViews, 'Views'),
        windowSeconds: null,
        expiryStart: null,
        viewSeconds: inRange(int(input.viewSeconds, L.defaultViewSec), L.minViewSec, L.maxViewSec, 'Seconds per view'),
        notifyOnView: input.notifyOnView !== false,
        revokeOnCapture: false,
      };
    }
    case 'TIMED': {
      const L = LIMITS.TIMED;
      const windowSeconds = inRange(
        int(input.windowSeconds, L.defaultWindowSec),
        L.minWindowSec,
        L.maxWindowSec,
        'Time window',
      );
      const start = input.expiryStart ?? 'ON_FIRST_VIEW';
      if (start !== 'ON_SEND' && start !== 'ON_FIRST_VIEW') {
        throw new PolicyError('Expiry must start on send or on first view.');
      }
      return {
        mode: 'TIMED',
        maxViews: null,
        windowSeconds,
        expiryStart: start,
        // A single view can last the whole window; the viewer also stops at expiresAt.
        viewSeconds: windowSeconds,
        notifyOnView: input.notifyOnView !== false,
        revokeOnCapture: false,
      };
    }
    case 'EPHEMERAL': {
      const L = LIMITS.EPHEMERAL;
      return {
        mode: 'EPHEMERAL',
        maxViews: inRange(int(input.maxViews, L.defaultViews), L.minViews, L.maxViews, 'Views'),
        windowSeconds: null,
        expiryStart: null,
        viewSeconds: inRange(int(input.viewSeconds, L.defaultViewSec), L.minViewSec, L.maxViewSec, 'Seconds per view'),
        notifyOnView: true,
        revokeOnCapture: true,
      };
    }
    default:
      throw new PolicyError('Mode must be MULTI_VIEW, TIMED or EPHEMERAL.');
  }
}
