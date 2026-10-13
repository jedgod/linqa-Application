// Client copy of the API's username rules (api/src/profile/username.ts).
// Keep the two in sync. The server is the final check.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

const PATTERN = /^[a-z][a-z0-9_.]*$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

/** Returns an error message, or null when the format is valid. */
export function usernameFormatError(raw: string): string | null {
  const u = normalizeUsername(raw);
  if (u.length < USERNAME_MIN) return `Use at least ${USERNAME_MIN} characters.`;
  if (u.length > USERNAME_MAX) return `Use ${USERNAME_MAX} characters or fewer.`;
  if (!PATTERN.test(u)) return 'Start with a letter. Use only letters, numbers, underscores and dots.';
  if (u.endsWith('.') || u.includes('..')) return 'Dots cannot be doubled or at the end.';
  return null;
}
