// Username rules, shared by the API. The mobile app has a matching copy in lib/username.ts.
//
// - 3 to 30 characters after removing a leading "@"
// - lowercase letters, digits, underscore and dot
// - must start with a letter, cannot end with a dot, no ".." in a row
// - stored lowercase so "@Keona" and "@keona" are the same handle

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

const PATTERN = /^[a-z][a-z0-9_.]*$/;

const RESERVED = new Set([
  'admin',
  'administrator',
  'linqa',
  'support',
  'help',
  'root',
  'system',
  'official',
  'security',
  'moderator',
  'staff',
  'me',
  'null',
  'undefined',
]);

export type UsernameCheck =
  | { ok: true; username: string }
  | { ok: false; reason: string };

export function normalizeUsername(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

export function validateUsername(raw: unknown): UsernameCheck {
  const username = normalizeUsername(raw);

  if (username.length < USERNAME_MIN) {
    return { ok: false, reason: `Use at least ${USERNAME_MIN} characters.` };
  }
  if (username.length > USERNAME_MAX) {
    return { ok: false, reason: `Use ${USERNAME_MAX} characters or fewer.` };
  }
  if (!PATTERN.test(username)) {
    return {
      ok: false,
      reason: 'Start with a letter. Use only letters, numbers, underscores and dots.',
    };
  }
  if (username.endsWith('.') || username.includes('..')) {
    return { ok: false, reason: 'Dots cannot be doubled or at the end.' };
  }
  if (RESERVED.has(username)) {
    return { ok: false, reason: 'That username is reserved.' };
  }
  return { ok: true, username };
}
