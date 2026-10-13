// Call this when linqa-core delivers a message whose content type is
// "protected_media". It moves the key into the device keychain and returns the
// message content WITHOUT the key, which is what you should save in chat history.

import { rememberMediaKey } from './keyStore';
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
  await rememberMediaKey(payload.mediaId, payload.secret);
  const { secret: _secret, ...rest } = payload;
  return rest;
}

/** The sender's own copy of the message should also be stored without the key. */
export function stripSecret(payload: ProtectedMediaPayload): StoredProtectedMedia {
  const { secret: _secret, ...rest } = payload;
  return rest;
}
