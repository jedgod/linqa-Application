// Call this when linqa-core delivers a message whose content type is
// "protected_media". It moves the key into the device keychain and returns the
// message content WITHOUT the key, which is what you should save in chat history.

import { rememberMediaKeyOnce } from './keyStore';
import type { ProtectedMediaPayload } from './send';

export type StoredProtectedMedia = Omit<ProtectedMediaPayload, 'secret'>;

export function isProtectedMediaPayload(x: unknown): x is ProtectedMediaPayload {
  const p = x as Partial<ProtectedMediaPayload> | null;
  return (
    !!p &&
    p.type === 'protected_media' &&
    p.v === 1 &&
    typeof p.mediaId === 'string' &&
    typeof p.secret?.key === 'string' &&
    typeof p.secret?.nonce === 'string'
  );
}

export async function receiveProtectedPhoto(payload: ProtectedMediaPayload): Promise<StoredProtectedMedia> {
  await rememberMediaKeyOnce(payload.mediaId, payload.secret);
  const { secret: _secret, ...rest } = payload;
  return rest;
}

/** The sender's own copy of the message should also be stored without the key. */
export function stripSecret(payload: ProtectedMediaPayload): StoredProtectedMedia {
  const { secret: _secret, ...rest } = payload;
  return rest;
}

/** What a message carries in place of the key once it has been moved out. It is not a usable key. */
export const REDACTED_SECRET = { key: `${'A'.repeat(43)}=`, nonce: 'A'.repeat(32) };

/**
 * Called on every decrypted message before it reaches the chat. A protected photo's key goes into the keychain
 * (the recipient only) and the message the screen and history see carries a blank in its place.
 * Anything else comes back unchanged.
 */
export async function ingestProtectedMessage(text: string, ownMessage: boolean): Promise<string> {
  if (!text.includes('protected_media')) return text;
  let parsed: { type?: unknown; content?: unknown } | null;
  try { parsed = JSON.parse(text); } catch { return text; }
  const content = parsed?.type === 'feature' ? parsed.content : parsed;
  if (!isProtectedMediaPayload(content)) return text;
  if (!ownMessage) await receiveProtectedPhoto(content).catch(() => undefined);
  const stripped = { ...stripSecret(content), secret: REDACTED_SECRET };
  return JSON.stringify(parsed?.type === 'feature' ? { ...parsed, content: stripped } : stripped);
}
